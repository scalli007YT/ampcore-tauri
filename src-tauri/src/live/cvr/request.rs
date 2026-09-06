//! General-purpose UDP request/response primitive for the CVR protocol:
//! inbound multi-fragment reassembly, a pending-request registry with
//! per-request correlation, and settle-timer + hard-timeout + retry
//! mechanics. Built for FC=27 (SYNC_DATA)'s bulk multi-frame response, but
//! deliberately not FC=27-specific — any future one-shot request/response
//! FC degenerates to the same primitive (one frame arrives, the settle timer
//! elapses with no follow-up, it resolves).
//!
//! The reference implementation has the same frames+settle-timer shape but
//! keys pending requests only by `(ip, function_code)` with no per-request
//! correlation — a stale reply from an already-timed-out request can be
//! misattributed to a newer request for the same key. This module fixes
//! that with a monotonic generation counter per key (see `RequestRegistry`).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tokio::sync::oneshot;

use crate::data::common::now_millis;

use super::protocol::{FC_SYNC_DATA, NETWORK_HEADER_LEN};

pub const REQUEST_TIMEOUT_MS: u64 = 2000;
pub const REQUEST_RETRY_TIMEOUT_MS: u64 = 2200;
pub const SETTLE_MS: u64 = 20;
pub const MAX_RETRIES: u8 = 1;
/// Half-assembled fragment sets older than this are dropped — a lost
/// fragment must not wedge a source IP's reassembly state forever.
pub const FRAGMENT_MAX_AGE_MS: f64 = 3_000.0;

#[derive(Debug)]
pub enum RequestError {
    Timeout,
    /// The concatenated response didn't match any plausible shape for its
    /// function code (see `RequestRegistry::resolve`'s FC=27 check) — a real
    /// surfaced error, never silently handed to a byte parser as if valid.
    ShapeMismatch(usize),
    /// Another request was already pending for this IP (any function code)
    /// when this one was submitted — rejected before ever registering it.
    /// Necessary because `FragmentReassembler`'s `by_ip` map (see below) has
    /// no per-function-code or per-request correlation id to key on — the
    /// wire's `NetworkDataHeader` doesn't carry one at the individual
    /// fragment level — so two concurrent multi-fragment response streams
    /// from the same IP (e.g. the FC=27 poll tick and an on-demand FC=59
    /// fetch racing each other) would silently interleave into one garbled
    /// buffer instead of failing loudly. Retriable — the caller should back
    /// off briefly and try again once the other exchange has resolved.
    Busy,
}

/// Where a resolved request's result goes. `Internal` is what the driver's
/// own FC=27 poll tick uses — handled synchronously, inline, in the same
/// loop iteration that discovers the resolution (no channel, no await:
/// parsing ~2.5KB of already-in-memory bytes is not actually async work).
/// `External` is for a future Tauri command reaching in from outside the
/// driver's task — fire-and-forget `send` on the oneshot; the command's own
/// async task is what awaits the `Receiver`, not the driver loop.
pub enum ResultSink {
    Internal,
    External(oneshot::Sender<Result<Vec<u8>, RequestError>>),
}

pub struct RequestSpec {
    pub ip: String,
    pub function_code: u8,
    pub body: Vec<u8>,
    pub sink: ResultSink,
}

struct PendingRequest {
    generation: u64,
    body: Vec<u8>,
    frames: Vec<Vec<u8>>,
    hard_deadline: Instant,
    settle_deadline: Option<Instant>,
    retries_left: u8,
    sink: ResultSink,
}

pub struct ResolvedRequest {
    pub ip: String,
    pub function_code: u8,
    pub result: Result<Vec<u8>, RequestError>,
    pub sink: ResultSink,
}

/// Bytes to (re)send for a request still awaiting its reply — returned by
/// `register`/`poll_deadlines` so the driver loop does the actual
/// `socket.send_to`, keeping this module free of any I/O.
pub struct Transmit {
    pub ip: String,
    pub packet: Vec<u8>,
}

#[derive(Default)]
pub struct RequestRegistry {
    generations: HashMap<(String, u8), u64>,
    pending: HashMap<(String, u8), PendingRequest>,
}

impl RequestRegistry {
    /// True if a request for `ip` is in flight under ANY function code — the
    /// driver uses this (not `has_pending`) before registering anything new
    /// for that ip, since the shared per-IP `FragmentReassembler` can't
    /// safely interleave two concurrent multi-fragment exchanges regardless
    /// of which function codes they're for (see `RequestError::Busy`).
    pub fn has_pending_for_ip(&self, ip: &str) -> bool {
        self.pending.keys().any(|(pending_ip, _)| pending_ip == ip)
    }

    /// Registers a new request, bumping the `(ip, fc)` generation counter.
    /// Returns the outbound packet to send plus, if a *different* request
    /// was already pending for this key (shouldn't happen given callers
    /// check `has_pending` first, but guarded regardless), that superseded
    /// request resolved as a failure.
    pub fn register(&mut self, spec: RequestSpec, now: Instant) -> (Vec<u8>, Option<ResolvedRequest>) {
        let key = (spec.ip.clone(), spec.function_code);
        let generation = self.generations.entry(key.clone()).and_modify(|g| *g += 1).or_insert(1);
        let generation = *generation;

        let packet = super::protocol::build_protocol_packet(spec.function_code, 2, 0, &spec.body);

        let superseded = self.pending.remove(&key).map(|old| ResolvedRequest {
            ip: key.0.clone(),
            function_code: key.1,
            result: Err(RequestError::Timeout),
            sink: old.sink,
        });

        self.pending.insert(
            key,
            PendingRequest {
                generation,
                body: spec.body,
                frames: Vec::new(),
                hard_deadline: now + Duration::from_millis(REQUEST_TIMEOUT_MS),
                settle_deadline: None,
                retries_left: MAX_RETRIES,
                sink: spec.sink,
            },
        );

        (packet, superseded)
    }

    /// Feeds one already-reassembled logical frame (StructHeader+body+
    /// checksum, i.e. `Assembled::Multi`) into the matching pending request,
    /// if any. A frame that doesn't match a *live* (current-generation)
    /// pending entry — because there is no pending request for this `(ip,
    /// fc)`, or because the one that used to be there already resolved or
    /// timed out and moved to a new generation — is silently discarded. This
    /// is the concrete fix for the reference implementation's stale-frame
    /// misattribution bug: since `pending` holds at most one entry per key
    /// and every entry is tagged with the generation active when it was
    /// registered, a late frame from an old, already-removed entry can never
    /// land in a newer one.
    pub fn on_frame(&mut self, ip: &str, function_code: u8, frame: Vec<u8>, now: Instant) {
        let key = (ip.to_string(), function_code);
        let Some(current_gen) = self.generations.get(&key) else { return };
        let Some(pending) = self.pending.get_mut(&key) else { return };
        if pending.generation != *current_gen {
            return;
        }
        pending.frames.push(frame);
        pending.settle_deadline = Some(now + Duration::from_millis(SETTLE_MS));
    }

    /// Drives settle/timeout/retry for every pending request. Returns
    /// resolved requests (to be delivered via their `sink`) and any packets
    /// that need retransmitting. Never blocks, never awaits anything —
    /// purely a synchronous sweep over in-memory state.
    pub fn poll_deadlines(&mut self, now: Instant) -> (Vec<ResolvedRequest>, Vec<Transmit>) {
        let mut resolved = Vec::new();
        let mut retransmits = Vec::new();
        let mut done_keys = Vec::new();

        for (key, pending) in self.pending.iter_mut() {
            if let Some(settle_deadline) = pending.settle_deadline {
                if now >= settle_deadline {
                    done_keys.push(key.clone());
                    continue;
                }
            }
            if now >= pending.hard_deadline {
                if pending.retries_left > 0 {
                    pending.retries_left -= 1;
                    pending.hard_deadline = now + Duration::from_millis(REQUEST_RETRY_TIMEOUT_MS);
                    pending.frames.clear();
                    pending.settle_deadline = None;
                    let packet = super::protocol::build_protocol_packet(key.1, 2, 0, &pending.body);
                    retransmits.push(Transmit { ip: key.0.clone(), packet });
                } else {
                    done_keys.push(key.clone());
                }
            }
        }

        for key in done_keys {
            let Some(pending) = self.pending.remove(&key) else { continue };
            let (ip, function_code) = key;
            // Reached "done" either via the settle timer firing after at
            // least one frame arrived (resolve it), or via the hard deadline
            // with retries exhausted and nothing ever arrived (timeout).
            let result =
                if pending.frames.is_empty() { Err(RequestError::Timeout) } else { resolve_frames(function_code, pending.frames) };
            resolved.push(ResolvedRequest { ip, function_code, result, sink: pending.sink });
        }

        (resolved, retransmits)
    }
}

/// Concatenates accumulated frames and, for FC=27 specifically, sanity-checks
/// the result's shape before accepting it — a mismatch becomes a real
/// surfaced error rather than silently corrupt data handed to the channel
/// parser. Other function codes have no known fixed shape to check against
/// (they degenerate to "whatever came back"), so they pass through as-is.
fn resolve_frames(function_code: u8, frames: Vec<Vec<u8>>) -> Result<Vec<u8>, RequestError> {
    let body: Vec<u8> = frames.into_iter().flatten().collect();
    if function_code == FC_SYNC_DATA {
        use super::channel_config_v118::{BYTES_PER_CHANNEL, TRAILER_SIZE_V118};
        // The frame here still includes StructHeader+checksum; the pure
        // per-channel body starts after StructHeader (10) and ends before
        // the checksum (3) — see channel_config.rs's slicing convention.
        //
        // This check is 1.1.8-shaped (imports its constants directly) even
        // though `resolve_frames` itself is firmware-agnostic — there's no
        // other known-good shape to validate against yet (1.1.9 has none;
        // see `channel_config_v119.rs`). Revisit if/when a second firmware's
        // real geometry is confirmed.
        let inner_len = body.len().saturating_sub(super::protocol::STRUCT_HEADER_LEN + super::protocol::CHECKSUM_LEN);
        let plausible = inner_len >= TRAILER_SIZE_V118
            && (inner_len - TRAILER_SIZE_V118) % BYTES_PER_CHANNEL == 0
            && (1..=4).contains(&((inner_len - TRAILER_SIZE_V118) / BYTES_PER_CHANNEL));
        if !plausible {
            return Err(RequestError::ShapeMismatch(body.len()));
        }
    }
    Ok(body)
}

struct FragmentState {
    packets_count: u8,
    received: HashMap<u8, Vec<u8>>,
    first_seen_at: f64,
}

/// What one reassembled logical frame looks like, depending on whether real
/// multi-datagram reassembly happened.
pub enum Assembled {
    /// `packets_count <= 1` — the ORIGINAL full datagram, byte-for-byte
    /// unchanged. Existing FC=0/FC=6 dispatch keeps consuming this exactly
    /// as it does today; nothing about those code paths changes.
    Single(Vec<u8>),
    /// Genuine multi-fragment reassembly — the concatenated inner frame
    /// (StructHeader + body + checksum, i.e. the same shape as today's
    /// `assembled = &raw[NETWORK_HEADER_LEN..]`), for FC=27 handling.
    Multi(Vec<u8>),
}

#[derive(Default)]
pub struct FragmentReassembler {
    by_ip: HashMap<String, FragmentState>,
}

impl FragmentReassembler {
    pub fn accept(&mut self, ip: &str, nd: &super::protocol::NetworkDataHeader, raw_datagram: &[u8]) -> Option<Assembled> {
        if nd.packets_count <= 1 {
            return Some(Assembled::Single(raw_datagram.to_vec()));
        }
        if raw_datagram.len() < NETWORK_HEADER_LEN {
            return None;
        }
        let inner = raw_datagram[NETWORK_HEADER_LEN..].to_vec();

        let state = self.by_ip.entry(ip.to_string()).or_insert_with(|| FragmentState {
            packets_count: nd.packets_count,
            received: HashMap::new(),
            first_seen_at: now_millis(),
        });
        // A fragment set for a different packets_count arriving mid-assembly
        // means the previous one was abandoned (lost fragments) — restart.
        if state.packets_count != nd.packets_count {
            *state =
                FragmentState { packets_count: nd.packets_count, received: HashMap::new(), first_seen_at: now_millis() };
        }
        state.received.insert(nd.packets_step, inner);

        if state.received.len() < nd.packets_count as usize {
            return None;
        }

        let state = self.by_ip.remove(ip)?;
        let mut steps: Vec<u8> = state.received.keys().copied().collect();
        steps.sort_unstable();
        let assembled: Vec<u8> = steps.into_iter().flat_map(|step| state.received[&step].clone()).collect();
        Some(Assembled::Multi(assembled))
    }

    /// Drops half-assembled fragment sets older than `max_age_ms` — call
    /// periodically (the driver's `deadline_tick` branch) so a lost fragment
    /// can't wedge an IP's reassembly state forever.
    pub fn sweep(&mut self, max_age_ms: f64) {
        let now = now_millis();
        self.by_ip.retain(|_, state| now - state.first_seen_at <= max_age_ms);
    }
}
