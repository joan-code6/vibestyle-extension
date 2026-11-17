---
name: VibeStyle
description: A compact browser-native website customizer.
colors:
  primary: "#bf1f62"
  primary-hover: "#a61752"
  primary-soft: "#fceaf2"
  background: "#fafafa"
  surface: "#ffffff"
  foreground: "#25252b"
  muted: "#65656d"
  line: "#e4e4e8"
  error: "#a92237"
  switch-off: "#777782"
  dark-primary: "#e96099"
  dark-primary-hover: "#ef7baa"
  dark-primary-soft: "#3b2530"
  dark-background: "#1d1d21"
  dark-surface: "#25252b"
  dark-foreground: "#efeff2"
  dark-muted: "#aaaab5"
  dark-line: "#3b3b44"
  dark-error: "#ff96a4"
  dark-primary-ink: "#26121c"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 600
rounded:
  control: "8px"
  message: "12px"
  composer: "14px"
spacing:
  compact: "8px"
  control: "12px"
  section: "20px"
  group: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  composer:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.composer}"
    padding: "12px"
---

# Design System: VibeStyle

## Overview

**Creative North Star: "A Browser Utility"**

VibeStyle uses familiar browser controls and a spare conversation layout. Its character comes from precise spacing, system typography, and a restrained pink accent. The interface follows the user's system light or dark preference.

**Key Characteristics:**

- Compact, flat surfaces.
- System typography and sentence-case controls.
- Pink reserved for brand, actions, focus, and enabled state.
- Visible state and error copy without decorative imagery.

## Colors

### Primary

Primary pink identifies actions, links, focus, and enabled controls. Its soft companion distinguishes user messages. Dark mode uses brighter pink with dark ink on filled actions.

### Neutral

Background, surface, foreground, muted, and line tokens establish the working hierarchy. The off-switch track stays distinct from both the white thumb and surrounding surface. Error colors change with the system theme.

**The State Color Rule.** Use the accent for interaction and enabled state; preserve neutral surfaces for reading and input.

## Typography

The same system sans stack serves headings, body, and controls. Body text is regular; titles and labels are moderately weighted. Setup headings are larger (31px), empty-state headings are smaller (25px), and site headings remain compact (14px). Metadata uses small supporting text (10–12px).

**The Native Type Rule.** Keep system typography throughout the extension; code previews alone use the browser's monospace default.

## Layout

The app fills the viewport height with a minimum working height (380px) and a maximum width (560px). The brand header and site controls stay above the scrollable conversation; the composer stays below it. Main horizontal insets are consistent (20px), with slightly wider setup insets (24px). At narrow widths (320px and below), insets reduce to preserve usable input space.

Conversation text wraps long content, hostnames truncate, and script previews scroll. Setup uses a single vertical form rather than multiple columns.

## Elevation & Depth

Surfaces use tonal differences and thin borders, with no shadows. The composer and form fields sit on the surface color; the site bar uses separators.

**The Flat Surface Rule.** Express hierarchy with spacing, tone, and borders rather than elevation effects.

## Shapes

Controls have compact rounded corners; user messages and the composer have more generous corners. The site switch alone uses a pill track with a circular thumb. State indicators are small circles.

## Components

- **Primary buttons:** filled pink, moderate weight, compact padding, and a darker hover. Dark mode changes filled-action ink. Disabled actions fade; keyboard focus uses a visible accent outline.
- **Icon buttons:** transparent compact targets with neutral hover backgrounds. Destructive hover uses the error color.
- **Fields:** surface fill, thin neutral border, rounded corners, visible labels, and system-native provider/model selection.
- **Composer:** bordered surface, multiline input, small model label, and a square arrow action. Focus changes its border to accent.
- **Site switch:** muted off track, accent on track, and a sliding thumb. Use the semantic switch role and expose checked state.
- **Messages:** author labels precede plain text; only the user's message receives a soft pink container.
- **Progress:** a small pulsing dot accompanies text. Reduced-motion preference removes animation and transitions.

## Do's and Don'ts

### Do:

- **Do** keep controls and body text in the same system sans family.
- **Do** preserve light and dark semantic color roles.
- **Do** use explicit labels, keyboard focus, and visible operation states.
- **Do** let the conversation scroll while preserving access to the composer.

### Don't:

- **Don't** add decorative imagery, gradients, or shadow layers to this minimal utility.
- **Don't** replace the compact site controls with a dashboard or nested cards.
- **Don't** hide errors or enabled state behind color alone.
