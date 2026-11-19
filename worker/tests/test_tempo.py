import pytest

from musica_worker.tempo import BpmRange, agrees, detect_bpm, fold_into_range, parse_bpm_tag

from .conftest import SR, kick_loop

PSY = BpmRange(138, 150)


def test_fold_doubles_half_time():
    assert fold_into_range(71.0, PSY) == (142.0, "doubled")


def test_fold_halves_double_time():
    assert fold_into_range(290.0, PSY) == (145.0, "halved")


def test_fold_leaves_in_range_and_unknown_alone():
    assert fold_into_range(145.0, PSY) == (145.0, None)
    assert fold_into_range(100.0, PSY) == (100.0, None)
    assert fold_into_range(100.0, None) == (100.0, None)


@pytest.mark.parametrize("text,bpm", [("140", 140.0), ("140,50", 140.5), (128.0, 128.0),
                                      ("", None), ("fast", None), ("0", None), (None, None)])
def test_parse_bpm_tag(text, bpm):
    assert parse_bpm_tag(text) == bpm


def test_agrees_with_half_and_double_time():
    assert agrees(140, 140.5)
    assert agrees(70, 140)
    assert not agrees(128, 140)


@pytest.mark.parametrize("bpm", [128, 140, 145])
def test_detects_tempo_of_kick_loop(bpm):
    detected, confidence = detect_bpm(kick_loop(bpm), SR)
    assert agrees(detected, bpm, tolerance=0.015), detected
    assert confidence >= 0.5
