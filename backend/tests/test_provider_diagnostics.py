import httpx
import pytest
from pydantic import SecretStr
from test_generations import image

from app.api import generation_provider as provider
from app.core.settings import Settings


@pytest.mark.parametrize("status,code,reason,outcome", [
    (400, "bad", "invalid_request", "PROVIDER_REJECTED"),
    (400, "content_policy_violation", "safety", "PROVIDER_REJECTED"),
    (401, "bad", "authentication", "PROVIDER_REJECTED"),
    (403, "bad", "permission", "PROVIDER_REJECTED"),
    (404, "bad", "model_unavailable", "PROVIDER_REJECTED"),
    (429, "insufficient_quota", "quota", "PROVIDER_REJECTED"),
    (429, "rate_limit_exceeded", "rate_limit", "PROVIDER_REJECTED"),
    (503, "bad", "upstream", "OUTCOME_UNKNOWN"),
])
def test_allowlisted_diagnostics_without_network(monkeypatch, status, code, reason, outcome):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(status, json={"error": {"code": code,
                              "message": "secret-key and private prompt never retained"}})

    original = httpx.Client
    monkeypatch.setattr(provider, "get_settings", lambda: Settings(
        _env_file=None, openai_api_key=SecretStr("test-not-a-real-key")))
    monkeypatch.setattr(provider.httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(provider.ProviderFailure) as raised:
        provider.generate_image(image(), "private", "hash")
    error = raised.value
    assert error.code == outcome and error.http_status == status and error.reason == reason
    assert "secret-key" not in str(error) and "private" not in repr(vars(error))
    assert calls == [1]


@pytest.mark.parametrize("body", [b"not-json", b"x" * 20_000,
                                 b'{"error":{"code":"secret-value","message":"private"}}'])
def test_malformed_and_unrecognized_errors_never_escape(body):
    error = provider.rejection(httpx.Response(400, content=body))
    assert error.reason == "invalid_request" and "secret-value" not in repr(vars(error))


def test_transport_errors_remain_ambiguous_without_leaking_raw_exception(monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("secret-key/private-prompt", request=request)

    original = httpx.Client
    monkeypatch.setattr(provider, "get_settings", lambda: Settings(
        _env_file=None, openai_api_key=SecretStr("test-only")))
    monkeypatch.setattr(provider.httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(provider.ProviderFailure) as raised:
        provider.generate_image(image(), "private", "hash")
    assert raised.value.code == "OUTCOME_UNKNOWN" and raised.value.reason == "timeout"
    assert raised.value.__suppress_context__


def test_unknown_diagnostic_values_are_not_retained():
    error = provider.ProviderFailure("secret-key", "private", "private-prompt")
    assert error.code == "OUTCOME_UNKNOWN" and error.http_status is None and error.reason is None
    assert "private" not in repr(vars(error)) and "secret-key" not in str(error)
