#import <ApplicationServices/ApplicationServices.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <unistd.h>

static const NSUInteger SpeakMoreMaxAXDescendantScanNodes = 1500;

static CFStringRef SpeakMoreAXEditableAttribute(void) {
  return CFSTR("AXEditable");
}

static NSString *StringOrEmpty(id value) {
  if ([value isKindOfClass:[NSString class]]) return value;
  if ([value respondsToSelector:@selector(stringValue)]) return [value stringValue];
  return @"";
}

static NSString *AXStringAttribute(AXUIElementRef element, CFStringRef attribute) {
  if (element == NULL) return @"";

  CFTypeRef value = NULL;
  AXError error = AXUIElementCopyAttributeValue(element, attribute, &value);
  if (error != kAXErrorSuccess || value == NULL) return @"";

  NSString *result = @"";
  if (CFGetTypeID(value) == CFStringGetTypeID()) {
    result = [(__bridge NSString *)value copy];
  }
  CFRelease(value);
  return result ?: @"";
}

static NSDictionary *AXStringAttributeResult(AXUIElementRef element, CFStringRef attribute) {
  if (element == NULL) {
    return @{
      @"success": @NO,
      @"text": @"",
      @"reason": @"macos_focused_element_unavailable",
    };
  }

  CFTypeRef value = NULL;
  AXError error = AXUIElementCopyAttributeValue(element, attribute, &value);
  if (error != kAXErrorSuccess || value == NULL) {
    return @{
      @"success": @NO,
      @"text": @"",
      @"reason": @"macos_observed_text_unavailable",
    };
  }

  NSString *text = @"";
  BOOL success = NO;
  if (CFGetTypeID(value) == CFStringGetTypeID()) {
    text = [(__bridge NSString *)value copy] ?: @"";
    success = YES;
  }
  CFRelease(value);

  return @{
    @"success": @(success),
    @"text": text ?: @"",
    @"reason": success ? @"macos_observed_text_read" : @"macos_observed_text_unavailable",
  };
}

static NSString *LimitText(NSString *value) {
  NSString *text = value ?: @"";
  if ([text length] <= 4000) return text;
  return [text substringToIndex:4000];
}

static BOOL AXBoolAttribute(AXUIElementRef element, CFStringRef attribute, BOOL fallback) {
  if (element == NULL) return fallback;

  CFTypeRef value = NULL;
  AXError error = AXUIElementCopyAttributeValue(element, attribute, &value);
  if (error != kAXErrorSuccess || value == NULL) return fallback;

  BOOL result = fallback;
  if (CFGetTypeID(value) == CFBooleanGetTypeID()) {
    result = CFBooleanGetValue((CFBooleanRef)value);
  }
  CFRelease(value);
  return result;
}

static NSDictionary *BoundsForElement(AXUIElementRef element) {
  CGFloat x = 0;
  CGFloat y = 0;
  CGFloat width = 0;
  CGFloat height = 0;

  CFTypeRef positionValue = NULL;
  if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &positionValue) == kAXErrorSuccess && positionValue != NULL) {
    CGPoint position;
    if (AXValueGetValue((AXValueRef)positionValue, kAXValueCGPointType, &position)) {
      x = position.x;
      y = position.y;
    }
    CFRelease(positionValue);
  }

  CFTypeRef sizeValue = NULL;
  if (AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &sizeValue) == kAXErrorSuccess && sizeValue != NULL) {
    CGSize size;
    if (AXValueGetValue((AXValueRef)sizeValue, kAXValueCGSizeType, &size)) {
      width = size.width;
      height = size.height;
    }
    CFRelease(sizeValue);
  }

  return @{
    @"x": @(x),
    @"y": @(y),
    @"width": @(width),
    @"height": @(height),
  };
}

static NSRunningApplication *FrontmostApplication(void) {
  return [[NSWorkspace sharedWorkspace] frontmostApplication];
}

static NSDictionary *FrontmostAppInfo(void) {
  NSRunningApplication *app = FrontmostApplication();
  if (app == nil) {
    return @{
      @"success": @NO,
      @"source": @"macos_workspace",
      @"confidence": @"none",
      @"reason": @"macos_frontmost_app_unavailable",
    };
  }

  return @{
    @"success": @YES,
    @"source": @"macos_workspace",
    @"confidence": @"confirmed",
    @"bundle_id": StringOrEmpty([app bundleIdentifier]),
    @"process_name": StringOrEmpty([app localizedName]),
    @"process_id": @([app processIdentifier]),
  };
}

static AXUIElementRef CopyFocusedElement(void) {
  NSRunningApplication *frontmostApp = FrontmostApplication();
  pid_t processId = frontmostApp != nil ? [frontmostApp processIdentifier] : 0;

  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (systemWide != NULL) {
    CFTypeRef focused = NULL;
    AXError error = AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute, &focused);
    CFRelease(systemWide);
    if (error == kAXErrorSuccess && focused != NULL) return (AXUIElementRef)focused;
  }

  if (processId > 0) {
    AXUIElementRef appElement = AXUIElementCreateApplication(processId);
    if (appElement != NULL) {
      CFTypeRef focused = NULL;
      AXError error = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, &focused);
      CFRelease(appElement);
      if (error == kAXErrorSuccess && focused != NULL) return (AXUIElementRef)focused;
    }
  }

  return NULL;
}

static NSArray *AXArrayAttribute(AXUIElementRef element, CFStringRef attribute) {
  if (element == NULL) return @[];

  CFTypeRef value = NULL;
  AXError error = AXUIElementCopyAttributeValue(element, attribute, &value);
  if (error != kAXErrorSuccess || value == NULL) return @[];

  if (CFGetTypeID(value) != CFArrayGetTypeID()) {
    CFRelease(value);
    return @[];
  }

  return CFBridgingRelease(value);
}

static BOOL AXHasSelectedTextRange(AXUIElementRef element) {
  if (element == NULL) return NO;

  CFTypeRef value = NULL;
  AXError error = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute, &value);
  if (error != kAXErrorSuccess || value == NULL) return NO;

  CFRelease(value);
  return YES;
}

static BOOL IsTextInputRole(NSString *role, NSString *subrole) {
  NSArray *roles = @[
    @"AXTextArea",
    @"AXTextField",
    @"AXComboBox",
    @"AXSearchField",
  ];
  if ([roles containsObject:role]) return YES;
  return [subrole isEqualToString:@"AXTextField"] || [subrole isEqualToString:@"AXSearchField"];
}

static BOOL IsTextInputContainerRole(NSString *role, NSString *subrole) {
  NSArray *roles = @[
    @"AXWebArea",
    @"AXGroup",
    @"AXScrollArea",
    @"AXWindow",
  ];
  if ([roles containsObject:role]) return YES;
  return [subrole isEqualToString:@"AXStandardWindow"];
}

static BOOL IsWritableTextInputElement(AXUIElementRef element) {
  if (element == NULL) return NO;

  NSString *role = AXStringAttribute(element, kAXRoleAttribute);
  NSString *subrole = AXStringAttribute(element, kAXSubroleAttribute);
  BOOL enabled = AXBoolAttribute(element, kAXEnabledAttribute, YES);
  BOOL editable = AXBoolAttribute(element, SpeakMoreAXEditableAttribute(), NO);
  Boolean valueSettable = false;
  AXUIElementIsAttributeSettable(element, kAXValueAttribute, &valueSettable);

  return enabled && IsTextInputRole(role, subrole) && (editable || valueSettable);
}

static BOOL IsActiveTextInputElement(AXUIElementRef element) {
  if (!IsWritableTextInputElement(element)) return NO;
  return AXBoolAttribute(element, kAXFocusedAttribute, NO) || AXHasSelectedTextRange(element);
}

static AXUIElementRef CopyFirstTextInputDescendant(AXUIElementRef root, BOOL allowInactiveFallback) {
  if (root == NULL) return NULL;

  NSMutableArray *queue = [NSMutableArray arrayWithObject:(__bridge id)root];
  AXUIElementRef fallback = NULL;
  NSUInteger scanned = 0;

  while ([queue count] > 0 && scanned < SpeakMoreMaxAXDescendantScanNodes) {
    id item = [queue objectAtIndex:0];
    [queue removeObjectAtIndex:0];
    scanned += 1;

    AXUIElementRef element = (__bridge AXUIElementRef)item;
    if (IsActiveTextInputElement(element)) {
      CFRetain(element);
      if (fallback != NULL) CFRelease(fallback);
      return element;
    }

    if (allowInactiveFallback && fallback == NULL && IsWritableTextInputElement(element)) {
      CFRetain(element);
      fallback = element;
    }

    NSArray *children = AXArrayAttribute(element, kAXChildrenAttribute);
    for (id child in children) {
      if (CFGetTypeID((__bridge CFTypeRef)child) == AXUIElementGetTypeID()) {
        [queue addObject:child];
      }
    }
  }

  return fallback;
}

static AXUIElementRef CopyTextInputDescendantFromFrontmostApp(void) {
  NSRunningApplication *frontmostApp = FrontmostApplication();
  if (frontmostApp == nil) return NULL;

  AXUIElementRef appElement = AXUIElementCreateApplication([frontmostApp processIdentifier]);
  if (appElement == NULL) return NULL;

  CFTypeRef focusedWindow = NULL;
  AXError windowError = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute, &focusedWindow);
  if (windowError == kAXErrorSuccess && focusedWindow != NULL) {
    AXUIElementRef windowTarget = CopyFirstTextInputDescendant((AXUIElementRef)focusedWindow, YES);
    CFRelease(focusedWindow);
    if (windowTarget != NULL) {
      CFRelease(appElement);
      return windowTarget;
    }
  }

  AXUIElementRef appTarget = CopyFirstTextInputDescendant(appElement, YES);
  CFRelease(appElement);
  return appTarget;
}

static AXUIElementRef CopyFocusedElementWithDescendantFallback(BOOL *usedDescendantScan) {
  if (usedDescendantScan != NULL) *usedDescendantScan = NO;

  AXUIElementRef focused = CopyFocusedElement();
  if (focused != NULL) {
    if (IsWritableTextInputElement(focused)) return focused;

    NSString *role = AXStringAttribute(focused, kAXRoleAttribute);
    NSString *subrole = AXStringAttribute(focused, kAXSubroleAttribute);
    if (IsTextInputContainerRole(role, subrole)) {
      AXUIElementRef descendant = CopyFirstTextInputDescendant(focused, NO);
      if (descendant != NULL) {
        if (usedDescendantScan != NULL) *usedDescendantScan = YES;
        CFRelease(focused);
        return descendant;
      }
    }

    return focused;
  }

  AXUIElementRef scanned = CopyTextInputDescendantFromFrontmostApp();
  if (scanned != NULL && usedDescendantScan != NULL) *usedDescendantScan = YES;
  return scanned;
}

static AXUIElementRef CopyFocusedElementWithMissingFallback(void) {
  AXUIElementRef focused = CopyFocusedElement();
  if (focused != NULL) return focused;
  return CopyTextInputDescendantFromFrontmostApp();
}

static AXUIElementRef CopyFocusedElementForTextOperations(void) {
  return CopyFocusedElementWithDescendantFallback(NULL);
}

static NSString *FocusedWindowTitle(pid_t processId) {
  AXUIElementRef appElement = AXUIElementCreateApplication(processId);
  if (appElement == NULL) return @"";

  CFTypeRef focusedWindow = NULL;
  AXError error = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute, &focusedWindow);
  CFRelease(appElement);
  if (error != kAXErrorSuccess || focusedWindow == NULL) return @"";

  NSString *title = AXStringAttribute((AXUIElementRef)focusedWindow, kAXTitleAttribute);
  CFRelease(focusedWindow);
  return title ?: @"";
}

static NSDictionary *AccessibilityStatus(void) {
  BOOL trusted = AXIsProcessTrusted();
  return @{
    @"success": @YES,
    @"source": @"macos_ax",
    @"confidence": trusted ? @"confirmed" : @"none",
    @"trusted": @(trusted),
    @"reason": trusted ? @"accessibility_trusted" : @"macos_accessibility_permission_missing",
  };
}

static NSDictionary *FocusedInfo(void) {
  BOOL trusted = AXIsProcessTrusted();
  NSDictionary *appInfo = FrontmostAppInfo();
  if (!trusted) {
    return @{
      @"success": @NO,
      @"source": @"macos_ax",
      @"confidence": @"none",
      @"reason": @"macos_accessibility_permission_missing",
      @"appInfo": @{
        @"app_name": appInfo[@"process_name"] ?: @"",
        @"app_identifier": appInfo[@"bundle_id"] ?: @"",
        @"window_title": @"",
        @"app_type": @"native_app",
        @"app_metadata": @{
          @"bundle_id": appInfo[@"bundle_id"] ?: @"",
          @"process_id": appInfo[@"process_id"] ?: @0,
        },
        @"browser_context": [NSNull null],
      },
      @"elementInfo": @{
        @"role": @"",
        @"focused": @NO,
        @"editable": @NO,
        @"selected": @NO,
        @"bounds": @{ @"x": @0, @"y": @0, @"width": @0, @"height": @0 },
      },
    };
  }

  AXUIElementRef focused = CopyFocusedElementForTextOperations();
  NSString *role = AXStringAttribute(focused, kAXRoleAttribute);
  NSString *subrole = AXStringAttribute(focused, kAXSubroleAttribute);
  BOOL focusedState = AXBoolAttribute(focused, kAXFocusedAttribute, focused != NULL);
  BOOL editable = AXBoolAttribute(focused, SpeakMoreAXEditableAttribute(), NO);
  BOOL selected = [AXStringAttribute(focused, kAXSelectedTextAttribute) length] > 0;
  Boolean valueSettable = false;
  if (focused != NULL) {
    AXUIElementIsAttributeSettable(focused, kAXValueAttribute, &valueSettable);
  }

  NSString *windowTitle = @"";
  NSNumber *processId = appInfo[@"process_id"] ?: @0;
  if ([processId intValue] > 0) {
    windowTitle = FocusedWindowTitle((pid_t)[processId intValue]);
  }

  NSDictionary *result = @{
    @"success": @YES,
    @"source": @"macos_ax",
    @"confidence": @"confirmed",
    @"appInfo": @{
      @"app_name": appInfo[@"process_name"] ?: @"",
      @"app_identifier": appInfo[@"bundle_id"] ?: @"",
      @"window_title": windowTitle ?: @"",
      @"app_type": @"native_app",
      @"app_metadata": @{
        @"bundle_id": appInfo[@"bundle_id"] ?: @"",
        @"process_id": processId,
      },
      @"browser_context": [NSNull null],
    },
    @"elementInfo": @{
      @"role": role ?: @"",
      @"subrole": subrole ?: @"",
      @"focused": @(focusedState),
      @"editable": @(editable || valueSettable),
      @"selected": @(selected),
      @"bounds": focused != NULL ? BoundsForElement(focused) : @{ @"x": @0, @"y": @0, @"width": @0, @"height": @0 },
    },
  };

  if (focused != NULL) CFRelease(focused);
  return result;
}

static NSDictionary *SelectedText(void) {
  BOOL trusted = AXIsProcessTrusted();
  NSDictionary *appInfo = FrontmostAppInfo();
  NSNumber *processId = appInfo[@"process_id"] ?: @0;

  if (!trusted) {
    return @{
      @"success": @NO,
      @"text": @"",
      @"source": @"macos_ax",
      @"confidence": @"none",
      @"reason": @"macos_accessibility_permission_missing",
      @"selection_scope": @"focused_element",
      @"app_identifier": appInfo[@"bundle_id"] ?: @"",
      @"process_id": processId,
    };
  }

  AXUIElementRef focused = CopyFocusedElementWithMissingFallback();
  if (focused == NULL) {
    return @{
      @"success": @NO,
      @"text": @"",
      @"source": @"macos_ax",
      @"confidence": @"none",
      @"reason": @"macos_focused_element_unavailable",
      @"selection_scope": @"focused_element",
      @"app_identifier": appInfo[@"bundle_id"] ?: @"",
      @"process_id": processId,
    };
  }

  NSString *selectedText = AXStringAttribute(focused, kAXSelectedTextAttribute);
  NSString *role = AXStringAttribute(focused, kAXRoleAttribute);
  NSString *subrole = AXStringAttribute(focused, kAXSubroleAttribute);
  BOOL hasText = [selectedText stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]].length > 0;

  NSDictionary *result = @{
    @"success": @(hasText),
    @"text": hasText ? selectedText : @"",
    @"source": @"macos_ax",
    @"confidence": hasText ? @"confirmed" : @"none",
    @"reason": hasText ? @"macos_selected_text_confirmed" : @"macos_selected_text_empty",
    @"selection_scope": @"focused_element",
    @"role": role ?: @"",
    @"subrole": subrole ?: @"",
    @"app_identifier": appInfo[@"bundle_id"] ?: @"",
    @"process_id": processId,
  };

  CFRelease(focused);
  return result;
}

static NSDictionary *FocusedTextTarget(void) {
  BOOL trusted = AXIsProcessTrusted();
  NSDictionary *appInfo = FrontmostAppInfo();
  NSString *appFamily = appInfo[@"bundle_id"] ?: appInfo[@"process_name"] ?: @"";
  NSNumber *processId = appInfo[@"process_id"] ?: @0;

  if (!trusted) {
    return @{
      @"success": @NO,
      @"source": @"none",
      @"confidence": @"none",
      @"reason": @"macos_accessibility_permission_missing",
      @"value_pattern": @NO,
      @"text_pattern": @NO,
      @"is_read_only": @NO,
      @"control_type": @"",
      @"app_family": appFamily,
      @"foreground_hwnd": StringOrEmpty(appInfo[@"bundle_id"]),
      @"focus_hwnd": [processId stringValue],
      @"caret_hwnd": @"",
      @"matched_signals": @[],
    };
  }

  BOOL usedDescendantScan = NO;
  AXUIElementRef focused = CopyFocusedElementWithDescendantFallback(&usedDescendantScan);
  if (focused == NULL) {
    return @{
      @"success": @NO,
      @"source": @"none",
      @"confidence": @"none",
      @"reason": @"macos_focused_target_unavailable",
      @"value_pattern": @NO,
      @"text_pattern": @NO,
      @"is_read_only": @NO,
      @"control_type": @"",
      @"app_family": appFamily,
      @"foreground_hwnd": StringOrEmpty(appInfo[@"bundle_id"]),
      @"focus_hwnd": [processId stringValue],
      @"caret_hwnd": @"",
      @"matched_signals": @[],
    };
  }

  NSString *role = AXStringAttribute(focused, kAXRoleAttribute);
  NSString *subrole = AXStringAttribute(focused, kAXSubroleAttribute);
  BOOL enabled = AXBoolAttribute(focused, kAXEnabledAttribute, YES);
  BOOL editable = AXBoolAttribute(focused, SpeakMoreAXEditableAttribute(), NO);
  Boolean valueSettable = false;
  AXUIElementIsAttributeSettable(focused, kAXValueAttribute, &valueSettable);
  BOOL textRole = IsTextInputRole(role, subrole);
  BOOL readOnly = !enabled || (!editable && !valueSettable);
  BOOL success = enabled && !readOnly && textRole;

  NSMutableArray *signals = [NSMutableArray arrayWithObject:@"frontmost_app"];
  if (usedDescendantScan) [signals addObject:@"ax_descendant_scan"];
  if (role.length > 0) [signals addObject:[NSString stringWithFormat:@"role:%@", role]];
  if (subrole.length > 0) [signals addObject:[NSString stringWithFormat:@"subrole:%@", subrole]];
  if (editable) [signals addObject:@"ax_editable"];
  if (valueSettable) [signals addObject:@"ax_value_settable"];

  NSDictionary *result = @{
    @"success": @(success),
    @"source": success ? @"macos_ax" : @"none",
    @"confidence": success ? @"confirmed" : @"none",
    @"reason": success ? @"macos_focused_target_confirmed" : @"macos_focused_target_unavailable",
    @"value_pattern": @(valueSettable),
    @"text_pattern": @(textRole),
    @"is_read_only": @(readOnly),
    @"control_type": role ?: @"",
    @"app_family": appFamily,
    @"foreground_hwnd": StringOrEmpty(appInfo[@"bundle_id"]),
    @"focus_hwnd": [processId stringValue],
    @"caret_hwnd": @"",
    @"matched_signals": signals,
  };

  CFRelease(focused);
  return result;
}

static NSDictionary *FocusedTextForObservation(void) {
  BOOL trusted = AXIsProcessTrusted();
  NSDictionary *appInfo = FrontmostAppInfo();
  NSString *appFamily = appInfo[@"bundle_id"] ?: appInfo[@"process_name"] ?: @"";
  NSNumber *processId = appInfo[@"process_id"] ?: @0;

  if (!trusted) {
    return @{
      @"success": @NO,
      @"text": @"",
      @"source": @"macos_ax",
      @"confidence": @"none",
      @"reason": @"macos_accessibility_permission_missing",
      @"app_identifier": StringOrEmpty(appInfo[@"bundle_id"]),
      @"app_family": appFamily,
      @"process_id": processId,
      @"role": @"",
      @"subrole": @"",
      @"bounds": @{ @"x": @0, @"y": @0, @"width": @0, @"height": @0 },
    };
  }

  AXUIElementRef focused = CopyFocusedElementForTextOperations();
  if (focused == NULL) {
    return @{
      @"success": @NO,
      @"text": @"",
      @"source": @"macos_ax",
      @"confidence": @"none",
      @"reason": @"macos_focused_element_unavailable",
      @"app_identifier": StringOrEmpty(appInfo[@"bundle_id"]),
      @"app_family": appFamily,
      @"process_id": processId,
      @"role": @"",
      @"subrole": @"",
      @"bounds": @{ @"x": @0, @"y": @0, @"width": @0, @"height": @0 },
    };
  }

  NSString *role = AXStringAttribute(focused, kAXRoleAttribute);
  NSString *subrole = AXStringAttribute(focused, kAXSubroleAttribute);
  NSDictionary *textResult = AXStringAttributeResult(focused, kAXValueAttribute);
  BOOL readable = [textResult[@"success"] boolValue];
  NSString *text = LimitText(textResult[@"text"] ?: @"");

  NSDictionary *result = @{
    @"success": @(readable),
    @"text": readable ? text : @"",
    @"source": @"macos_ax",
    @"confidence": readable ? @"confirmed" : @"none",
    @"reason": readable ? @"macos_observed_text_read" : (textResult[@"reason"] ?: @"macos_observed_text_unavailable"),
    @"app_identifier": StringOrEmpty(appInfo[@"bundle_id"]),
    @"app_family": appFamily,
    @"process_id": processId,
    @"role": role ?: @"",
    @"subrole": subrole ?: @"",
    @"bounds": BoundsForElement(focused),
  };

  CFRelease(focused);
  return result;
}

static NSDictionary *SendPasteShortcut(void) {
  if (!AXIsProcessTrusted()) {
    return @{
      @"success": @NO,
      @"source": @"macos_cgevent",
      @"confidence": @"none",
      @"reason": @"macos_accessibility_permission_missing",
    };
  }

  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (source == NULL) {
    return @{
      @"success": @NO,
      @"source": @"macos_cgevent",
      @"confidence": @"none",
      @"reason": @"macos_event_injection_failed",
    };
  }

  CGEventRef keyDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, true);
  CGEventRef keyUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, false);
  if (keyDown == NULL || keyUp == NULL) {
    if (keyDown != NULL) CFRelease(keyDown);
    if (keyUp != NULL) CFRelease(keyUp);
    CFRelease(source);
    return @{
      @"success": @NO,
      @"source": @"macos_cgevent",
      @"confidence": @"none",
      @"reason": @"macos_event_injection_failed",
    };
  }

  CGEventSetFlags(keyDown, kCGEventFlagMaskCommand);
  CGEventSetFlags(keyUp, kCGEventFlagMaskCommand);
  CGEventPost(kCGHIDEventTap, keyDown);
  usleep(20000);
  CGEventPost(kCGHIDEventTap, keyUp);

  CFRelease(keyDown);
  CFRelease(keyUp);
  CFRelease(source);

  return @{
    @"success": @YES,
    @"source": @"macos_cgevent",
    @"confidence": @"sent",
    @"reason": @"macos_event_injection_sent",
  };
}

static void PrintJSON(NSDictionary *payload) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (data == nil) {
    fprintf(stderr, "JSON serialization failed\n");
    exit(2);
  }
  fwrite([data bytes], 1, [data length], stdout);
  fputc('\n', stdout);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *command = argc >= 2 ? [NSString stringWithUTF8String:argv[1]] : @"";

    if ([command isEqualToString:@"accessibility-status"]) {
      PrintJSON(AccessibilityStatus());
      return 0;
    }
    if ([command isEqualToString:@"frontmost-app"]) {
      PrintJSON(FrontmostAppInfo());
      return 0;
    }
    if ([command isEqualToString:@"focused-info"]) {
      PrintJSON(FocusedInfo());
      return 0;
    }
    if ([command isEqualToString:@"selected-text"]) {
      PrintJSON(SelectedText());
      return 0;
    }
    if ([command isEqualToString:@"focused-text-target"]) {
      PrintJSON(FocusedTextTarget());
      return 0;
    }
    if ([command isEqualToString:@"focused-text-observation"]) {
      PrintJSON(FocusedTextForObservation());
      return 0;
    }
    if ([command isEqualToString:@"send-paste-shortcut"]) {
      PrintJSON(SendPasteShortcut());
      return 0;
    }

    PrintJSON(@{
      @"success": @NO,
      @"source": @"macos_platform_helper",
      @"confidence": @"none",
      @"reason": @"macos_helper_unknown_command",
    });
    return 1;
  }
}
