using System.Windows.Automation;

namespace WindowsTextObserver;

public sealed class TextObserver : IDisposable
{
    private AutomationElement? observedElement;
    private string? audioId;
    private System.Threading.Timer? debounceTimer;
    private Action<ObserverResponse>? emit;

    public ObserverResponse Start(ObserverRequest request, Action<ObserverResponse> emitResponse)
    {
        Stop("replaced");
        audioId = request.AudioId;
        emit = emitResponse;

        observedElement = AutomationElement.FocusedElement;
        if (observedElement == null)
        {
            return new ObserverResponse("observe-started", audioId, false, "focused_element_unavailable");
        }

        if (!observedElement.TryGetCurrentPattern(TextPattern.Pattern, out _))
        {
            return new ObserverResponse("observe-started", audioId, false, "text_pattern_unavailable");
        }

        Automation.AddAutomationEventHandler(
            TextPattern.TextChangedEvent,
            observedElement,
            TreeScope.Element,
            OnTextChanged
        );

        return new ObserverResponse("observe-started", audioId, true);
    }

    public void Stop(string reason)
    {
        debounceTimer?.Dispose();
        debounceTimer = null;

        if (observedElement != null)
        {
            try
            {
                Automation.RemoveAutomationEventHandler(
                    TextPattern.TextChangedEvent,
                    observedElement,
                    OnTextChanged
                );
            }
            catch
            {
            }
        }

        observedElement = null;
        audioId = null;
        emit = null;
    }

    private void OnTextChanged(object sender, AutomationEventArgs args)
    {
        debounceTimer?.Dispose();
        debounceTimer = new System.Threading.Timer(_ => EmitCurrentText(), null, 800, Timeout.Infinite);
    }

    private void EmitCurrentText()
    {
        if (observedElement == null || audioId == null || emit == null) return;

        try
        {
            var pattern = (TextPattern)observedElement.GetCurrentPattern(TextPattern.Pattern);
            var text = pattern.DocumentRange.GetText(4000).Trim();
            emit(new ObserverResponse("observed-text", audioId, true, Text: text));
        }
        catch
        {
            emit(new ObserverResponse("observed-text", audioId, false, "read_text_failed"));
        }
    }

    public void Dispose()
    {
        Stop("disposed");
    }
}
