import numpy as np
import pytest

from musica_worker.keys import (ATONAL, detect_key, estimate_key, from_camelot, notation,
                                parse_key_tag, to_camelot)

from .conftest import SR, chord_pad, hz


@pytest.mark.parametrize("pc,minor,code", [
    (0, False, "8B"), (7, False, "9B"), (11, False, "1B"), (5, False, "7B"),
    (9, True, "8A"), (4, True, "9A"), (0, True, "5A"), (8, True, "1A"),
])
def test_camelot_round_trip(pc, minor, code):
    assert to_camelot(pc, minor) == code
    assert from_camelot(code) == (pc, minor)


def test_every_code_round_trips():
    for n in range(1, 13):
        for letter in "AB":
            code = f"{n}{letter}"
            assert to_camelot(*from_camelot(code)) == code


@pytest.mark.parametrize("tag,code", [
    ("8A", "8A"), ("12b", "12B"), ("Am", "8A"), ("A minor", "8A"), ("F#m", "11A"),
    ("Bbm", "3A"), ("C", "8B"), ("Ebmaj", "5B"), ("atonal", ATONAL), ("", None), ("??", None),
])
def test_parse_key_tag(tag, code):
    assert parse_key_tag(tag) == code


def test_notation():
    assert notation("8A") == "A minor"
    assert notation("3B") == "Db major"
    assert notation(ATONAL) == ATONAL


def test_flat_chroma_is_atonal():
    assert estimate_key(np.ones(12))[0] == ATONAL


def test_detects_a_minor_from_audio():
    # A minor: A C E, then D F A, then E G# B
    a = chord_pad([hz(57), hz(60), hz(64)], 4)
    d = chord_pad([hz(62), hz(65), hz(69)], 4)
    e = chord_pad([hz(64), hz(68), hz(71)], 2)
    a2 = chord_pad([hz(57), hz(60), hz(64)], 4)
    code, confidence = detect_key(np.concatenate([a, d, e, a2]), SR)
    assert code == "8A"
    assert confidence > 0.5


def test_detects_g_major_from_audio():
    g = chord_pad([hz(55), hz(59), hz(62)], 4)
    c = chord_pad([hz(60), hz(64), hz(67)], 3)
    d = chord_pad([hz(62), hz(66), hz(69)], 3)
    code, _ = detect_key(np.concatenate([g, c, d, g]), SR)
    assert code == "9B"


def test_noise_is_atonal():
    y = np.random.default_rng(1).standard_normal(SR * 8).astype(np.float32) * 0.3
    assert detect_key(y, SR)[0] == ATONAL
