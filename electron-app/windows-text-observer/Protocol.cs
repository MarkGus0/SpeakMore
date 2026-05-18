using System.Text.Json.Serialization;

namespace WindowsTextObserver;

public sealed record ObserverRequest(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("audioId")] string? AudioId,
    [property: JsonPropertyName("pastedText")] string? PastedText,
    [property: JsonPropertyName("timeoutMs")] int TimeoutMs
);

public sealed record ObserverResponse(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("audioId")] string? AudioId,
    [property: JsonPropertyName("success")] bool Success,
    [property: JsonPropertyName("code")] string? Code = null,
    [property: JsonPropertyName("text")] string? Text = null
);
