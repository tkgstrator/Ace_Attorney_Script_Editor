use aa_rom::sound::{
    channel::{Channel, PSG_BASE_TIMER, RELEASE},
    player::Player,
    tables::cnv_scale,
};
use std::sync::Arc;

#[test]
fn ncsf_scale_and_psg_reference() {
    assert_eq!(PSG_BASE_TIMER, 8006);
    assert_eq!(
        (cnv_scale(0), cnv_scale(95), cnv_scale(110), cnv_scale(127)),
        (-32768, -25, -12, 0)
    );
    assert_eq!(cnv_scale(128), 0);
}

#[test]
fn ncsf_initial_tick_and_release_volume() {
    let mut sseq = vec![0; 29];
    sseq[..4].copy_from_slice(b"SSEQ");
    sseq[0x18..0x1c].copy_from_slice(&28u32.to_le_bytes());
    sseq[28] = 0xff;
    let mut p = Player::new(&sseq, Arc::new(vec![]), vec![], 95, 64, 0xffff).unwrap();
    p.frame();
    assert_eq!(p.tick_frames, vec![0]);
    p.frame();
    assert_eq!(p.tick_frames, vec![0]);
    p.frame();
    assert_eq!(p.tick_frames, vec![0, 2]);
    let mut ch = Channel::new();
    ch.state = RELEASE;
    ch.ext_ampl = -25;
    ch.update_from_track(&p.tracks[0].view(), -100, -200);
    assert_eq!(ch.ext_ampl, -25);
}
