//! CVR firmware 1.1.9 write/control command encoding.
//!
//! No 1.1.9 hardware exists to verify a write path against yet — the only
//! CVR unit available for this work runs 1.1.8. This is a deliberate,
//! explicit placeholder rather than gating 1.1.9 devices out of writes
//! entirely: it reuses the 1.1.8 encoding verbatim (same FC, same body
//! layout). It WILL silently send the wrong bytes if 1.1.9's write protocol
//! has actually diverged from 1.1.8 — same honesty caveat as
//! `channel_config_v119.rs`.
//!
//! Replace this file's bodies with real 1.1.9-specific encodings once that
//! hardware exists to ground-truth against — kept as a separate file (not
//! just a re-export) so that divergence is a one-file change, not a refactor
//! that risks the already-verified 1.1.8 path.

use crate::data::capability::PowerMode;

pub fn build_set_output_mute(channel_index: u8, muted: bool) -> Vec<u8> {
    super::write_v118::build_set_output_mute(channel_index, muted)
}

pub fn build_set_input_mute(channel_index: u8, muted: bool) -> Vec<u8> {
    super::write_v118::build_set_input_mute(channel_index, muted)
}

pub fn build_set_output_trim(channel_index: u8, trim_db: f32) -> Vec<u8> {
    super::write_v118::build_set_output_trim(channel_index, trim_db)
}

pub fn build_set_output_volume(channel_index: u8, volume_db: f32) -> Vec<u8> {
    super::write_v118::build_set_output_volume(channel_index, volume_db)
}

pub fn build_set_delay_in(channel_index: u8, delay_ms: f32) -> Vec<u8> {
    super::write_v118::build_set_delay_in(channel_index, delay_ms)
}

pub fn build_set_delay_out(channel_index: u8, delay_ms: f32) -> Vec<u8> {
    super::write_v118::build_set_delay_out(channel_index, delay_ms)
}

pub fn build_set_phase_invert(channel_index: u8, inverted: bool) -> Vec<u8> {
    super::write_v118::build_set_phase_invert(channel_index, inverted)
}

pub fn build_set_power_mode(channel_index: u8, mode: PowerMode) -> Vec<u8> {
    super::write_v118::build_set_power_mode(channel_index, mode)
}

pub fn build_set_eq_filter_type(channel_index: u8, in_out_flag: u8, segment: u8, type_code: u8, active: bool) -> Vec<u8> {
    super::write_v118::build_set_eq_filter_type(channel_index, in_out_flag, segment, type_code, active)
}

pub fn build_set_eq_freq(channel_index: u8, in_out_flag: u8, segment: u8, freq_hz: f32) -> Vec<u8> {
    super::write_v118::build_set_eq_freq(channel_index, in_out_flag, segment, freq_hz)
}

pub fn build_set_eq_gain(channel_index: u8, in_out_flag: u8, band_index: u8, gain_db: f32) -> Vec<u8> {
    super::write_v118::build_set_eq_gain(channel_index, in_out_flag, band_index, gain_db)
}

pub fn build_set_eq_q(channel_index: u8, in_out_flag: u8, band_index: u8, q: f32) -> Vec<u8> {
    super::write_v118::build_set_eq_q(channel_index, in_out_flag, band_index, q)
}
