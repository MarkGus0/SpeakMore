using System.Text.Json;
using WindowsTextObserver;

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
};

using var observer = new TextObserver();

void WriteResponse(ObserverResponse response)
{
    Console.Out.WriteLine(JsonSerializer.Serialize(response, jsonOptions));
    Console.Out.Flush();
}

string? line;
while ((line = Console.In.ReadLine()) != null)
{
    ObserverRequest? request;
    try
    {
        request = JsonSerializer.Deserialize<ObserverRequest>(line, jsonOptions);
    }
    catch
    {
        WriteResponse(new ObserverResponse("error", null, false, "invalid_json"));
        continue;
    }

    if (request == null)
    {
        WriteResponse(new ObserverResponse("error", null, false, "empty_request"));
        continue;
    }

    if (request.Type == "observe-start")
    {
        WriteResponse(observer.Start(request, WriteResponse));
        continue;
    }

    if (request.Type == "observe-stop")
    {
        observer.Stop("requested");
        WriteResponse(new ObserverResponse("observe-stopped", request.AudioId, true));
        continue;
    }

    WriteResponse(new ObserverResponse("error", request.AudioId, false, "unknown_request_type"));
}
