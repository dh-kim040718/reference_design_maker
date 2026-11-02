import pytest

from app.api.generation_provider import ProviderFailure
from app.phase4_verification import prepare, single_attempt


def test_offline_preparation_and_single_durable_attempt(tmp_path):
    plan = prepare(tmp_path)
    assert plan["status"] == "prepared_no_paid_call"
    assert (tmp_path / "reference.png").exists()
    assert not (tmp_path / "live-attempt.json").exists()
    calls = []

    def provider(*args):
        calls.append(1)
        raise ProviderFailure("OUTCOME_UNKNOWN")

    guarded = single_attempt(provider, tmp_path, "1")
    with pytest.raises(ProviderFailure, match="OUTCOME_UNKNOWN"):
        guarded("source", "prompt", "safety")
    # A new process/closure must not allow another charge after an uncertain outcome.
    restarted = single_attempt(provider, tmp_path, "1")
    with pytest.raises(ProviderFailure, match="VERIFICATION_ALREADY_ATTEMPTED"):
        restarted("source", "prompt", "safety")
    assert calls == [1]


@pytest.mark.parametrize("amount", [None, "0", "-1", "NaN", "Infinity"])
def test_no_call_without_positive_budget(tmp_path, amount):
    with pytest.raises(ValueError):
        single_attempt(lambda *args: pytest.fail("Must never call the API"), tmp_path, amount)
