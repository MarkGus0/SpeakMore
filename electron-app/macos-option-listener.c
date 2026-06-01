#include <ApplicationServices/ApplicationServices.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

static const int64_t KEY_CODE_SPACE = 49;
static const int64_t KEY_CODE_ESCAPE = 53;

static bool option_is_down = false;
static bool shift_is_down = false;
static bool space_is_down = false;
static bool escape_is_down = false;

static void emit_key(const char *key, bool is_keydown) {
  printf("{\"key\":\"%s\",\"isKeydown\":%s}\n", key, is_keydown ? "true" : "false");
  fflush(stdout);
}

static void handle_flags_changed(CGEventRef event) {
  CGEventFlags flags = CGEventGetFlags(event);
  bool option_now = (flags & kCGEventFlagMaskAlternate) != 0;
  bool shift_now = (flags & kCGEventFlagMaskShift) != 0;

  if (option_now != option_is_down) {
    option_is_down = option_now;
    emit_key("RightAlt", option_now);

    if (!option_now) {
      if (shift_is_down) {
        shift_is_down = false;
        emit_key("RightShift", false);
      }
      if (space_is_down) {
        space_is_down = false;
        emit_key("Space", false);
      }
    }
  }

  if (option_now) {
    if (shift_now != shift_is_down) {
      shift_is_down = shift_now;
      emit_key("RightShift", shift_now);
    }
  } else if (shift_is_down) {
    shift_is_down = false;
    emit_key("RightShift", false);
  }
}

static void handle_key_event(CGEventType type, CGEventRef event) {
  int64_t key_code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  bool is_repeat = CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat) != 0;

  if (key_code == KEY_CODE_ESCAPE) {
    if (type == kCGEventKeyDown && !escape_is_down && !is_repeat) {
      escape_is_down = true;
      emit_key("Escape", true);
    }
    if (type == kCGEventKeyUp && escape_is_down) {
      escape_is_down = false;
      emit_key("Escape", false);
    }
    return;
  }

  if (key_code != KEY_CODE_SPACE || !option_is_down) {
    return;
  }

  if (type == kCGEventKeyDown && !space_is_down && !is_repeat) {
    space_is_down = true;
    emit_key("Space", true);
  }

  if (type == kCGEventKeyUp && space_is_down) {
    space_is_down = false;
    emit_key("Space", false);
  }
}

static CGEventRef event_callback(
  CGEventTapProxy proxy,
  CGEventType type,
  CGEventRef event,
  void *user_info
) {
  (void)proxy;
  (void)user_info;

  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    return event;
  }

  if (type == kCGEventFlagsChanged) {
    handle_flags_changed(event);
  } else if (type == kCGEventKeyDown || type == kCGEventKeyUp) {
    handle_key_event(type, event);
  }

  return event;
}

int main(void) {
  CGEventMask event_mask =
    CGEventMaskBit(kCGEventFlagsChanged)
    | CGEventMaskBit(kCGEventKeyDown)
    | CGEventMaskBit(kCGEventKeyUp);

  CFMachPortRef event_tap = CGEventTapCreate(
    kCGSessionEventTap,
    kCGHeadInsertEventTap,
    kCGEventTapOptionDefault,
    event_mask,
    event_callback,
    NULL
  );

  if (event_tap == NULL) {
    fputs("无法创建 macOS Option 监听器，请在系统设置中允许 SpeakMore 或当前终端使用辅助功能权限。\n", stderr);
    return 1;
  }

  CFRunLoopSourceRef run_loop_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, event_tap, 0);
  CFRunLoopAddSource(CFRunLoopGetCurrent(), run_loop_source, kCFRunLoopCommonModes);
  CGEventTapEnable(event_tap, true);
  CFRunLoopRun();

  CFRelease(run_loop_source);
  CFRelease(event_tap);
  return 0;
}
