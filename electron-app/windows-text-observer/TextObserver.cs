using System.Windows.Automation;

namespace WindowsTextObserver;

public sealed class TextObserver : IDisposable
{
    private enum ObservationMode
    {
        None,
        TextPattern,
        ValuePattern,
    }

    private AutomationElement? observedElement;
    private string? audioId;
    private System.Threading.Timer? debounceTimer;
    private Action<ObserverResponse>? emit;
    private readonly Action<string>? debug;
    private ObservationMode observationMode = ObservationMode.None;

    public TextObserver(Action<string>? debug = null)
    {
        this.debug = debug;
    }

    private void Log(string message)
    {
        try
        {
            debug?.Invoke(message);
        }
        catch
        {
        }
    }

    private static string DescribeElement(AutomationElement element)
    {
        try
        {
            return $"name={element.Current.Name}, controlType={element.Current.ControlType.ProgrammaticName}, processId={element.Current.ProcessId}, className={element.Current.ClassName}, automationId={element.Current.AutomationId}";
        }
        catch (Exception error)
        {
            return $"element_description_failed={error.Message}";
        }
    }

    private static string LimitText(string value)
    {
        return value.Length > 4000 ? value[..4000] : value;
    }

    public ObserverResponse Start(ObserverRequest request, Action<ObserverResponse> emitResponse)
    {
        Stop("replaced");
        audioId = request.AudioId;
        emit = emitResponse;
        Log($"start requested: audioId={audioId}, pastedText={request.PastedText}, timeoutMs={request.TimeoutMs}");

        observedElement = AutomationElement.FocusedElement;
        if (observedElement == null)
        {
            Log($"start failed: audioId={audioId}, focused element unavailable");
            return new ObserverResponse("observe-started", audioId, false, "focused_element_unavailable");
        }
        Log($"focused element: audioId={audioId}, {DescribeElement(observedElement)}");

        if (observedElement.TryGetCurrentPattern(TextPattern.Pattern, out _))
        {
            Automation.AddAutomationEventHandler(
                TextPattern.TextChangedEvent,
                observedElement,
                TreeScope.Element,
                OnTextChanged
            );

            observationMode = ObservationMode.TextPattern;
            Log($"start succeeded: audioId={audioId}, text pattern changed handler attached");
            return new ObserverResponse("observe-started", audioId, true);
        }

        if (observedElement.TryGetCurrentPattern(ValuePattern.Pattern, out var valuePatternObject))
        {
            var valuePattern = (ValuePattern)valuePatternObject;
            if (valuePattern.Current.IsReadOnly)
            {
                Log($"start failed: audioId={audioId}, value pattern read only, {DescribeElement(observedElement)}");
                return new ObserverResponse("observe-started", audioId, false, "read_only");
            }

            Automation.AddAutomationPropertyChangedEventHandler(
                observedElement,
                TreeScope.Element,
                OnValueChanged,
                ValuePattern.ValueProperty
            );

            observationMode = ObservationMode.ValuePattern;
            Log($"start succeeded: audioId={audioId}, value pattern changed handler attached");
            return new ObserverResponse("observe-started", audioId, true);
        }

        if (observationMode == ObservationMode.None)
        {
            Log($"start failed: audioId={audioId}, text/value pattern unavailable, {DescribeElement(observedElement)}");
            return new ObserverResponse("observe-started", audioId, false, "text_pattern_unavailable");
        }

        return new ObserverResponse("observe-started", audioId, false, "text_pattern_unavailable");
    }

    public void Stop(string reason)
    {
        Log($"stop requested: audioId={audioId}, reason={reason}, hasObservedElement={observedElement != null}");
        debounceTimer?.Dispose();
        debounceTimer = null;

        if (observedElement != null)
        {
            try
            {
                if (observationMode == ObservationMode.TextPattern)
                {
                    Automation.RemoveAutomationEventHandler(
                        TextPattern.TextChangedEvent,
                        observedElement,
                        OnTextChanged
                    );
                }

                if (observationMode == ObservationMode.ValuePattern)
                {
                    Automation.RemoveAutomationPropertyChangedEventHandler(
                        observedElement,
                        OnValueChanged
                    );
                }
            }
            catch
            {
                Log($"remove changed handler failed: audioId={audioId}, mode={observationMode}");
            }
        }

        observedElement = null;
        audioId = null;
        emit = null;
        observationMode = ObservationMode.None;
    }

    private void OnTextChanged(object sender, AutomationEventArgs args)
    {
        Log($"text changed event received: audioId={audioId}");
        ScheduleEmit();
    }

    private void OnValueChanged(object sender, AutomationPropertyChangedEventArgs args)
    {
        Log($"value changed event received: audioId={audioId}");
        ScheduleEmit();
    }

    private void ScheduleEmit()
    {
        debounceTimer?.Dispose();
        debounceTimer = new System.Threading.Timer(_ => EmitCurrentText(), null, 800, Timeout.Infinite);
    }

    private string ReadCurrentText()
    {
        if (observedElement == null)
        {
            return "";
        }

        if (observationMode == ObservationMode.TextPattern)
        {
            var pattern = (TextPattern)observedElement.GetCurrentPattern(TextPattern.Pattern);
            return pattern.DocumentRange.GetText(4000);
        }

        if (observationMode == ObservationMode.ValuePattern)
        {
            var pattern = (ValuePattern)observedElement.GetCurrentPattern(ValuePattern.Pattern);
            return LimitText(pattern.Current.Value ?? "");
        }

        return "";
    }

    private void EmitCurrentText()
    {
        if (observedElement == null || audioId == null || emit == null)
        {
            Log($"emit skipped: audioId={audioId}, hasElement={observedElement != null}, hasEmit={emit != null}");
            return;
        }

        try
        {
            var text = ReadCurrentText().Trim();
            Log($"observed text emitted: audioId={audioId}, text={text}");
            emit(new ObserverResponse("observed-text", audioId, true, Text: text));
        }
        catch (Exception error)
        {
            Log($"read observed text failed: audioId={audioId}, error={error.Message}");
            emit(new ObserverResponse("observed-text", audioId, false, "read_text_failed"));
        }
    }

    public void Dispose()
    {
        Stop("disposed");
    }
}
