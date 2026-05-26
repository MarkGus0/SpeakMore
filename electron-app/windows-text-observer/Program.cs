using System.Text.Json;
using WindowsTextObserver;

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
};

void WriteDebug(string message)
{
    Console.Error.WriteLine($"[{DateTimeOffset.Now:O}] [auto-learning-helper] {message}");
    Console.Error.Flush();
}

using var observer = new TextObserver(WriteDebug);

void WriteResponse(ObserverResponse response)
{
    Console.Out.WriteLine(JsonSerializer.Serialize(response, jsonOptions));
    Console.Out.Flush();
}

string? line;
while ((line = Console.In.ReadLine()) != null)
{
    WriteDebug($"stdin line received: {line}");
    ObserverRequest? request;
    try
    {
        request = JsonSerializer.Deserialize<ObserverRequest>(line, jsonOptions);
    }
    catch
    {
        WriteDebug("invalid json received");
        WriteResponse(new ObserverResponse("error", null, false, "invalid_json"));
        continue;
    }

    if (request == null)
    {
        WriteDebug("empty request received");
        WriteResponse(new ObserverResponse("error", null, false, "empty_request"));
        continue;
    }

    WriteDebug($"request parsed: type={request.Type}, audioId={request.AudioId}, pastedText={request.PastedText}, timeoutMs={request.TimeoutMs}");

    if (request.Type == "observe-start")
    {
        WriteResponse(observer.Start(request, WriteResponse));
        continue;
    }

    if (request.Type == "observe-stop")
    {
        WriteDebug($"observe-stop requested: audioId={request.AudioId}");
        observer.Stop("requested");
        WriteResponse(new ObserverResponse("observe-stopped", request.AudioId, true));
        continue;
    }

    WriteResponse(new ObserverResponse("error", request.AudioId, false, "unknown_request_type"));
}
