# Polar Marketing — Complete Design System

**Version:** 1.0  
**Status:** Design specification  
**Product:** Polar Marketing  
**Market:** Small businesses in Tenerife, Canary Islands  
**Primary experience:** Mobile-first marketing automation  
**Brand personality:** Minimal, playful, confident, approachable  
**Design philosophy:** Scandinavian minimalism with a distinctive lime accent

---

## 1. Purpose and scope

This document is the design-system source of truth for Polar Marketing. It defines:

- Brand identity and logo usage
- Light and dark themes
- Color tokens and semantic states
- Typography
- Spacing, layout, corners, borders, and shadows
- Buttons and interactive states
- Forms, validation, and language selection
- Cards, post previews, status pills, and navigation
- Icons, photography, and uploads
- Motion and feedback
- Accessibility
- Responsive behavior
- Signup, dashboard, and create-post screen specifications
- Reusable components and implementation conventions
- CSS design tokens
- Content states, QA checks, and implementation priorities

All new interfaces should follow this document. When a detail is unspecified, choose the simplest solution that preserves the established visual identity. Reuse existing components and tokens instead of inventing one-off patterns.

## 2. Brand foundation

### 2.1 Brand identity

Polar Marketing is an automated marketing service for small businesses. It helps business owners promote their businesses without needing to become marketing experts or manage every publication manually.

The interface must communicate:

- Simplicity
- Reliability
- Automation
- Approachability
- Professionalism
- Modernity
- Personality

The application should feel premium without being intimidating.

### 2.2 Design philosophy

The visual identity combines Scandinavian minimalism, playful branding, and modern SaaS functionality.

- **The supplied logo** provides the personality.
- **Black and white** provide structure.
- **Polar lime** identifies important actions and selected states.
- **Photography** brings businesses and their content to life.

### 2.3 Design principles

1. **Clarity before decoration.** Every element must have a purpose. Avoid unnecessary gradients, decorative illustrations, excessive borders, and redundant information.
2. **One primary action per context.** Each screen should have a clearly identifiable main action, emphasized with the lime primary button.
3. **Consistency over novelty.** Reuse components, spacing, typography, and color tokens.
4. **Friendly, not childish.** Rounded shapes and the supplied brand identity should be balanced with professional typography and restrained colors.
5. **Automation should feel effortless.** Minimize configuration and technical terminology. Users should be able to describe what they want to promote in natural language.
6. **Light and dark modes are equally intentional.** Dark mode must not be a simple inversion of light mode. Give both themes deliberate surface colors, borders, text colors, and interaction states.

## 3. Logo and brand assets

### 3.1 Source of truth

The user-provided logo is the authoritative brand asset. Use the supplied file rather than redrawing, approximating, or replacing it. Do not recreate the logo with CSS, text characters, emoji, or a generic icon.

### 3.2 Recommended assets

- Full logo in SVG
- Standalone brand symbol in SVG, if available
- Official light logo variant, if available
- Official dark logo variant, if available
- Transparent PNG fallback

SVG is preferred for crisp rendering at all screen sizes.

### 3.3 Logo rules

- Preserve the original aspect ratio and internal proportions.
- Do not stretch, distort, rotate, or crop the logo.
- Do not apply gradients, shadows, or outlines.
- Do not alter the shape of the brand symbol.
- Do not add lime backgrounds unless explicitly approved.
- Maintain adequate clear space around the asset.
- Do not use the complete logo as a repeated decorative element.
- Never substitute another animal or symbol.

### 3.4 Placement

**Signup:** Display the full logo near the top, visually separated from the headline.

**Dashboard:** Use a compact version in the application header, aligned with the business selector and account controls.

**Create-post screen:** Use the standalone symbol or compact logo if available. Prioritize the form and its primary action.

**Dark mode:** Prefer an official light logo variant on dark surfaces. If none is provided, place the original logo on a light surface rather than inventing an alternate version.

### 3.5 Asset organization

Suggested structure; adapt filenames to the actual supplied assets:

```text
assets/
  brand/
    polar-marketing-logo.svg
    polar-marketing-symbol.svg
    polar-marketing-logo-light.svg
```

If an asset is unavailable, do not silently replace it with a placeholder in the final implementation.

## 4. Color system

### 4.1 Core brand colors

| Token | Hex | Purpose |
|---|---|---|
| Polar Black | `#111111` | Logo, text, dark surfaces |
| Polar Lime | `#D7FF64` | Primary actions and highlights |
| Snow White | `#FFFFFF` | Cards and light surfaces |
| Arctic Grey | `#F3F4F3` | Light application background |
| Graphite | `#606568` | Secondary text |
| Muted Grey | `#8A9399` | Metadata and placeholders |
| Border Grey | `#E3E7E6` | Borders and dividers |

### 4.2 Light theme tokens

| Token | Hex | Purpose |
|---|---|---|
| `background` | `#F3F4F3` | Application background |
| `surface` | `#FFFFFF` | Cards and primary surfaces |
| `surface-secondary` | `#F3F4F3` | Secondary surfaces |
| `surface-tertiary` | `#EDEFEF` | Subtle control backgrounds |
| `text-primary` | `#111111` | Main text |
| `text-secondary` | `#606568` | Supporting text |
| `text-muted` | `#8A9399` | Metadata |
| `border` | `#E3E7E6` | Component borders |
| `border-strong` | `#C9CECC` | Stronger outlines |
| `accent` | `#D7FF64` | Brand accent |
| `accent-foreground` | `#111111` | Text on lime |
| `inverse-surface` | `#111111` | Dark hero panels |
| `inverse-text` | `#FFFFFF` | Text on dark panels |

### 4.3 Dark theme tokens

| Token | Hex | Purpose |
|---|---|---|
| `background` | `#0A0A0A` | Main application background |
| `surface` | `#181A1B` | Standard cards |
| `surface-secondary` | `#222526` | Secondary cards and fields |
| `surface-tertiary` | `#2A2E30` | Elevated controls |
| `text-primary` | `#F5F5F5` | Main text |
| `text-secondary` | `#C1C6C8` | Supporting text |
| `text-muted` | `#929A9E` | Metadata |
| `border` | `#34383A` | Borders and dividers |
| `border-strong` | `#505658` | Stronger outlines |
| `accent` | `#D7FF64` | Brand accent |
| `accent-foreground` | `#111111` | Text on lime |
| `inverse-surface` | `#FFFFFF` | Exceptional inverse surfaces |
| `inverse-text` | `#111111` | Text on white |

Dark mode should feel deep, restrained, and comfortable. Do not use pure black for every card; subtle surface differences establish hierarchy. Lime remains consistent between themes.

### 4.4 Semantic colors

Semantic colors communicate states, not branding.

| State | Light background | Light text | Dark background | Dark text |
|---|---|---|---|---|
| Success | `#E5F5D8` | `#315C20` | `#26351F` | `#C4F5A0` |
| Warning | `#FFF1CC` | `#795500` | `#3B3018` | `#FFD887` |
| Error | `#FCE8E6` | `#A12622` | `#402322` | `#FFB4AD` |
| Information | `#E8EEFF` | `#254A8A` | `#202C43` | `#B7CCFF` |

Use semantic colors only when their meaning is clear. Do not use lime as a substitute for every semantic state.

### 4.5 Color usage rules

Use lime for:
- Primary buttons
- Selected language options
- Active navigation indicators
- Important statistics
- Focus indicators where contrast permits
- Small, meaningful highlights

Use black for:
- Main headings
- Brand elements
- Strong text hierarchy
- Light-mode hero panels

Use neutral surfaces for forms, cards, navigation, and supporting content.

Do not introduce blue or teal as additional primary brand colors. Photographs may contain any natural colors.

### 4.6 Contrast

- Normal text must target WCAG AA contrast.
- Large text must target WCAG AA contrast.
- Interactive controls must remain distinguishable.
- Never use white text on bright lime buttons.
- Never rely on color alone to communicate status.
- Disabled controls must remain understandable.
- Focus indicators must remain visible in both themes.
- Validate actual contrast ratios during implementation; do not assume every suggested muted color passes on every surface.

## 5. Typography

### 5.1 Font families

- **Display:** Bricolage Grotesque
- **Body and interface:** Figtree
- **Fallback:** system sans-serif

Use the same font families in both themes.

### 5.2 Display typography

Use Bricolage Grotesque for:
- Main marketing headlines
- Primary screen headings
- Large statistics
- Important promotional statements

Use strong weights and relatively tight line heights. Avoid display typography for long paragraphs.

### 5.3 Interface typography

Use Figtree for:
- Body text
- Input labels
- Buttons
- Navigation
- Status indicators
- Supporting descriptions
- Metadata
- Timestamps

### 5.4 Type scale

| Token | Size | Weight | Line height | Typical use |
|---|---:|---:|---:|---|
| Display | 48 px | 700–800 | 1.05 | Marketing hero |
| H1 | 36 px | 700–800 | 1.10 | Main screen heading |
| H2 | 28 px | 700 | 1.15 | Section heading |
| H3 | 22 px | 600–700 | 1.25 | Card heading |
| H4 | 18 px | 600–700 | 1.30 | Subheading |
| Body Large | 18 px | 400–500 | 1.50 | Introductory copy |
| Body | 16 px | 400–500 | 1.50 | General text |
| Body Small | 14 px | 400–500 | 1.45 | Secondary text |
| Caption | 12 px | 400–500 | 1.40 | Metadata |
| Button | 16 px | 600–700 | 1.20 | Actions |

These values are starting points. Use responsive sizing where necessary.

### 5.5 Typography rules

- Prefer sentence case.
- Avoid excessive uppercase labels.
- Keep paragraphs short.
- Maintain a clear heading hierarchy.
- Do not use multiple unrelated font families.
- Do not reduce essential content to tiny metadata sizes.
- Avoid using font weight alone to distinguish different meanings.
- Ensure headings wrap naturally without clipping.

### 5.6 Responsive typography

On compact mobile screens, use approximately:
- Display: 36–40 px
- H1: 32–36 px
- H2: 24–28 px
- Body: 14–16 px

Avoid horizontal overflow and awkward headline wrapping.

## 6. Spacing system

Use an 8-point spacing system with 4 px increments.

| Token | Value | Typical use |
|---|---:|---|
| `space-1` | 4 px | Fine adjustments |
| `space-2` | 8 px | Compact gaps |
| `space-3` | 12 px | Related controls |
| `space-4` | 16 px | Standard component gaps |
| `space-5` | 24 px | Card padding and section gaps |
| `space-6` | 32 px | Section separation |
| `space-7` | 48 px | Major layout separation |
| `space-8` | 64 px | Large desktop spacing |
| `space-9` | 80 px | Large layout separation |

### 6.1 Mobile defaults

- Horizontal page padding: 24 px where practical
- Form field spacing: 16 px
- Standard card padding: 16–24 px
- Major section spacing: 24–32 px
- Button height: 48–56 px
- Minimum interactive target: approximately 44 × 44 px

Adapt values to small devices. Do not let the bottom action become inaccessible behind system navigation or the keyboard.

## 7. Corners, borders, and shadows

### 7.1 Border radius

| Token | Value | Usage |
|---|---:|---|
| `radius-xs` | 4 px | Small indicators |
| `radius-sm` | 8 px | Compact tags |
| `radius-md` | 12 px | Inputs |
| `radius-lg` | 16 px | Standard cards |
| `radius-xl` | 24 px | Major cards |
| `radius-2xl` | 32 px | Large promotional panels |
| `radius-pill` | 999 px | Buttons and pills |

### 7.2 Borders

Use 1 px borders by default.

- Light: `#E3E7E6`
- Dark: `#34383A`

Avoid unnecessary borders around every nested element. Use spacing and surface contrast to establish hierarchy.

### 7.3 Shadows

Light theme:
- Standard card: `0 4px 16px rgba(17,17,17,0.04)`
- Floating surface: `0 8px 24px rgba(17,17,17,0.08)`

Dark theme:
- Prefer subtle surface contrast and borders.
- Use shadows sparingly.
- Avoid heavy black shadows on dark backgrounds.

Keep the design crisp and flat. Do not use glassmorphism, excessive blur, or decorative gradients.

## 8. Button system

### 8.1 Primary button

Purpose: the main action within a screen or section.

Appearance:
- Background: polar lime
- Text: polar black
- Pill-shaped radius
- Height: 48–56 px
- Horizontal padding: 24 px
- Font weight: 700
- Optional trailing arrow icon

Mobile primary actions should generally occupy the available width.

Examples: `Create my website`, `Post it`, `Save changes`, `Continue`.

### 8.2 Secondary button

- Light theme: white background
- Dark theme: secondary surface background
- Primary text color
- Subtle border
- Rounded shape consistent with the component

Use for secondary actions.

### 8.3 Tertiary button

Use a transparent background with clear text and an optional icon. Suitable for `Cancel`, `Back`, `View details`, and `Dismiss`.

### 8.4 Destructive button

Use semantic error styling. Do not use lime for destructive actions. Require confirmation for irreversible actions where appropriate.

### 8.5 Button states

Every interactive button must support:
- Default
- Hover where applicable
- Focus
- Pressed
- Disabled
- Loading
- Success feedback where appropriate

Loading must prevent accidental duplicate submissions. Maintain the button's overall dimensions while loading.

### 8.6 Button rules

- One primary action per major context.
- Do not place several equally prominent lime buttons together.
- Do not use emoji in buttons.
- Use consistent labels.
- Do not make decorative elements look interactive.
- Provide visible keyboard focus.
- Ensure sufficient contrast.

## 9. Form components

### 9.1 Input structure

Each input should support:
- Visible label
- Input value
- Optional leading icon
- Optional trailing action
- Placeholder
- Helper text
- Focus state
- Error state
- Disabled state

Do not use placeholders as substitutes for labels.

### 9.2 Input appearance

**Light mode:** white surface, neutral border, dark text, muted placeholder.  
**Dark mode:** secondary surface background, dark-theme border, light text, muted placeholder.

Recommended standard input height: 52–56 px. Use 12–16 px corner radii.

### 9.3 Focus state

Focused inputs must have a clearly visible border or outline. Use the brand accent where contrast permits. Never remove focus indicators without providing an alternative.

### 9.4 Validation

Validation must explain how to correct the problem.

Examples:
- “Enter a business name.”
- “Enter a valid WhatsApp number.”
- “Choose a photo smaller than 10 MB.”

Show errors near the relevant field. Do not rely exclusively on red borders.

### 9.5 WhatsApp number

- Allow international phone numbers.
- Support the Spanish country code.
- Preserve the entered value appropriately.
- Validate before submitting.
- Explain invalid values clearly.
- Do not silently discard country codes or formatting.

### 9.6 Text area

Used for promotional descriptions.

Recommended minimum height: 160–180 px.

Requirements:
- Multiline input
- Visible label or clear heading
- Character count if a limit applies
- Placeholder with a concrete example
- Focus state
- Validation state
- Appropriate keyboard behavior

Users should be able to describe an offer in ordinary language.

## 10. Language selector

Initial supported languages:
- English
- Español

Use pill-shaped selectable controls.

**Selected:** lime background, black text, clear selected state.  
**Unselected:** neutral surface, neutral border, primary text.

Requirements:
- Keyboard accessible
- Screen-reader accessible
- Clear selected state
- Consistent component height
- Equal-width options when practical

Changing the language should update the interface consistently. Do not translate only the button while leaving other interface text in the previous language.

## 11. Card system

### 11.1 Standard card

Used for scheduled posts, published posts, business information, and settings sections.

- White surface in light mode
- Surface color in dark mode
- 16–24 px radius
- 16–24 px padding
- Subtle border
- Minimal shadow

### 11.2 Hero card

Example content:

> Your week on autopilot  
> **7** posts scheduled  
> Relax. We'll create, post and grow your audience this week.

Light theme: black surface, white text, lime highlights.  
Dark theme: slightly elevated dark surface with subtle borders. Preserve contrast with the application background.

Requirements:
- Large statistic
- Short heading
- Brief supporting text
- Minimal decoration
- No unnecessary charts

### 11.3 Post card

Each post card should contain:
- Thumbnail
- Post title
- Caption preview
- Hashtags or metadata
- Status
- Date and time where relevant

Use a consistent image ratio. Allow text to wrap without breaking the layout. Do not truncate essential status or scheduling information.

### 11.4 Empty cards

When no posts exist, show a short explanation, a useful next action, and an appropriate illustration or icon if necessary. Avoid empty dashboard areas that appear broken.

## 12. Status indicators

| State | Label | Treatment |
|---|---|---|
| Published | Posted | Success icon and success colors |
| Scheduled | Scheduled | Neutral or informational styling; show time where relevant |
| Needs review | Needs review | Warning colors |
| Failed | Failed | Error colors and recovery action |

Rules:
- Always include readable text.
- Use consistent icons.
- Keep pills compact.
- Do not use emoji.
- Do not communicate state through color alone.
- Keep the same state visually consistent throughout the application.

## 13. Iconography

Recommended library: **Lucide**. Use one consistent icon family.

Examples:
- Home
- Calendar
- Chart
- Settings
- Image
- MessageCircle
- Store
- Clock
- CheckCircle
- AlertTriangle
- X
- ArrowRight

### 13.1 Icon sizes

- Small: 16 px
- Standard: 20 px
- Large: 24 px
- Feature: 32 px

### 13.2 Icon rules

- Keep stroke widths consistent.
- Use neutral colors by default.
- Use lime for active or highlighted states.
- Maintain adequate touch targets around interactive icons.
- Provide accessible labels for icon-only controls.
- Do not use Unicode symbols as substitutes for interface icons.

The supplied logo must remain distinct from the functional icon system.

## 14. Navigation

### 14.1 Mobile navigation

Recommended destinations:
- Home
- Content
- Growth
- Settings

Use a bottom navigation bar when appropriate.

Requirements:
- Clear active state
- Consistent icons
- Short labels
- Adequate touch targets
- Safe-area support
- No content hidden behind the navigation

Active navigation may use a lime icon or a small lime indicator. Avoid making the entire navigation bar bright lime.

### 14.2 Desktop navigation

A sidebar may replace bottom navigation. Maintain the same destination names and information architecture. Do not create separate navigation concepts for different screen sizes.

### 14.3 Back navigation

Use a consistent back control on secondary screens. Preserve user-entered content when navigating back where appropriate.

## 15. Light and dark mode

### 15.1 Theme requirements

Every component must support both themes, including:
- Backgrounds
- Cards
- Text
- Inputs
- Borders
- Buttons
- Navigation
- Status indicators
- Dialogs
- Menus
- Upload areas
- Empty states
- Loading indicators

Do not implement dark mode only for the main background.

### 15.2 Theme selection

Recommended options:
- Light
- Dark
- System

System follows the device preference. Persist an explicit user preference across sessions. If no explicit preference exists, use the system preference.

### 15.3 Theme transition

Theme changes should not cause layout shifts. A short color transition is acceptable. Avoid animating every element individually if it creates visual noise.

### 15.4 Image treatment

Do not automatically invert photographs. Keep photographs natural in both themes. Maintain readable text over images by using suitable surfaces rather than unnecessary image filters.

### 15.5 Dark mode rules

- Avoid pure white backgrounds.
- Avoid using the same dark color for every surface.
- Preserve text hierarchy.
- Keep lime buttons with black text.
- Use subtle borders.
- Reduce unnecessary shadows.
- Ensure muted text remains readable.
- Keep status colors distinguishable.

## 16. Photography and media

### 16.1 Photography style

Use authentic, high-quality photography.

Suitable subjects:
- Tenerife landscapes
- Sunset boat trips
- Coastal excursions
- Restaurants
- Cafés
- Local businesses
- Hospitality
- Outdoor activities

### 16.2 Image treatment

- Prefer natural lighting.
- Avoid excessive saturation.
- Avoid unnecessary filters.
- Use consistent aspect ratios.
- Apply consistent corner radii.
- Crop images intentionally.
- Preserve image quality.
- Avoid stretching.

### 16.3 Upload component

The upload component must support:
- Selecting a photo
- Upload progress
- Preview
- Removing a selected photo
- Invalid file feedback
- Upload failure feedback
- Retry where appropriate

Show accepted file formats and maximum size when applicable. The UI must reflect the actual backend upload limits.

### 16.4 Empty upload state

Use a dashed border, a consistent image icon, and the label `Upload photo`. Add concise supporting text with accepted formats. Make the entire tile clickable when appropriate and provide a keyboard-accessible equivalent.

## 17. Motion and feedback

### 17.1 Principles

Motion should explain interaction, not be decorative by default.

### 17.2 Durations

| Type | Duration |
|---|---:|
| Small control feedback | 100–150 ms |
| Standard transitions | 150–250 ms |
| Larger panel transitions | 200–300 ms |

### 17.3 Permitted motion

- Button feedback
- Menu expansion
- Tab transitions
- Dialog appearance
- Upload progress
- Loading indicators
- Success confirmation
- Subtle card state changes

### 17.4 Reduced motion

Respect the operating system's reduced-motion preference. Avoid unnecessary movement when reduced motion is enabled.

### 17.5 Feedback

Every meaningful user action must provide appropriate feedback, including saving, uploading, publishing, scheduling, validation failure, and network failure.

Do not claim that a post was published unless the backend confirms it.

## 18. Accessibility

Target **WCAG 2.2 AA** where applicable.

### 18.1 Keyboard access

All interactive elements must be keyboard accessible. Provide visible focus indicators. Do not trap keyboard focus unexpectedly.

### 18.2 Screen readers

- Use semantic HTML.
- Provide accessible labels.
- Give icon-only controls meaningful names.
- Associate validation messages with inputs.
- Announce important asynchronous results appropriately.
- Mark decorative images appropriately.

### 18.3 Contrast

Maintain sufficient text and control contrast in both themes. Check muted text, disabled controls, status pills, and lime buttons.

### 18.4 Touch targets

Target at least 44 × 44 CSS pixels for interactive controls. Provide spacing between neighboring actions.

### 18.5 Forms

- Use explicit labels.
- Explain errors.
- Preserve entered values when possible.
- Do not rely only on color.
- Provide clear submission feedback.

### 18.6 Responsive text

Support browser zoom and text scaling. Avoid fixed-height containers that clip content.

## 19. Responsive design

Use a mobile-first implementation.

Suggested breakpoints:
- Small mobile: up to 374 px
- Mobile: 375–767 px
- Tablet: 768–1023 px
- Desktop: 1024–1439 px
- Large desktop: 1440 px and above

Treat these as initial breakpoints, not strict device categories.

### 19.1 Mobile

- Single-column layouts
- Full-width primary actions
- Compact navigation
- Comfortable touch targets
- Readable cards
- No horizontal scrolling

### 19.2 Tablet

- Wider cards
- More room for previews
- Optional two-column content
- Preserved mobile interaction patterns

### 19.3 Desktop

- Sidebar navigation where appropriate
- Maximum content width
- Wider dashboard layouts
- More space for content management
- Optional multi-column post layouts

### 19.4 General rules

- Do not hardcode device-specific heights unnecessarily.
- Use flexible layouts.
- Avoid horizontal overflow.
- Account for mobile safe areas.
- Test with the keyboard open.
- Preserve the visual hierarchy across sizes.

## 20. Screen specifications

### 20.1 Signup screen

**Objective:** Help a business owner understand the service and begin onboarding.

**Structure:**
1. Brand logo
2. Main headline
3. Supporting description
4. Business name field
5. WhatsApp number field
6. Language selector
7. Primary action
8. Reassurance text

**Headline:**
> Posted today. Every day.

**Description:**
> We create and post content for your business, so you can focus on what matters in Tenerife.

**Fields:**
- Business name
- WhatsApp number
- Content language

**Language options:** English, Español

**Primary action:** `Create my website`

**Design:**
- Light theme: near-white background.
- Dark theme: deep charcoal background.
- Black or white typography according to theme.
- Lime primary action in both themes.
- Neutral input surfaces.
- Generous spacing.
- Full logo near the top.

**Behavior:**
- Validate required fields.
- Validate the phone number.
- Preserve user input after recoverable errors.
- Display loading state during submission.
- Prevent duplicate submissions.
- Display clear success or failure feedback.
- Do not imply account creation succeeded before confirmation.

**Small-screen behavior:** Allow vertical scrolling when necessary. Keep fields and the primary action accessible. Do not compress the logo or headline excessively.

### 20.2 Client dashboard

**Objective:** Show users that their marketing is organized and make scheduled content easy to review.

**Header:**
- Compact logo
- Business selector
- Account controls where needed

**Hero card:**
> Your week on autopilot  
> **7** posts scheduled  
> Relax. We'll create, post and grow your audience this week.

The number must come from actual application data when connected. Use sample data only in prototypes or clearly identified demo states.

**Example post 1**

Title: `Sunset boat trip in Tenerife`

Caption: `Golden skies, calm waters and the best company. Join us for an unforgettable evening on the ocean.`

Hashtags: `#Tenerife #BoatTrip #Sunset`

Status: `Posted`

**Example post 2**

Title: `Dolphin watching adventure`

Caption: `Meet Tenerife's incredible marine life. A unique experience for all ages.`

Hashtags: `#Dolphins #Tenerife #Wildlife`

Status: `Scheduled · 10:00`

**Navigation:** Home, Content, Growth, Settings.

**Empty state:** When no posts exist, explain that the schedule is empty and provide a clear action to create or schedule content.

**Error state:** If content cannot be loaded, explain the problem and provide a retry action. Do not display fabricated post counts as live data.

### 20.3 Create-post screen

**Objective:** Let a user describe a promotion without needing marketing expertise.

**Heading:**
> What should we promote?

**Description:**
> Tell us about an offer, event or anything you want to share. We'll turn it into a beautiful post.

**Main field:** A large text area with a useful example.

Placeholder:
> e.g. A sunset boat trip this Friday. Mention it's 2 hours, drinks included, and perfect for couples.

**Photo section:** `Add a photo (optional)`

Provide an upload tile and preview.

**Primary action:** `Post it`

**Design:**
- Minimal layout
- Clear heading hierarchy
- Neutral text area
- Dashed upload border
- Natural image preview
- Lime primary button
- Compact brand symbol near the top

**Behavior:**
- Accept natural-language input.
- Validate required content.
- Support optional photo uploads.
- Show upload progress.
- Allow removing a selected photo.
- Preserve text if submission fails.
- Show loading feedback during processing.
- Explain whether the resulting post is a draft, scheduled, or published.
- Do not imply immediate publication if the workflow only creates a draft.

## 21. Content and writing style

### 21.1 Voice

Polar Marketing should sound clear, friendly, direct, professional, and encouraging.

Avoid corporate jargon, technical marketing terminology, excessive exclamation marks, unnecessary explanations, and vague error messages.

### 21.2 Interface copy

Prefer concise, action-oriented labels.

Good:
- `Create my website`
- `Post it`
- `Upload photo`
- `Try again`

Avoid vague labels such as `Proceed`, `Execute`, or `Submit operation`.

### 21.3 Error messages

Explain what happened and what the user can do next.

Example:
> We couldn't upload your photo. Check your connection and try again.

### 21.4 Success messages

Be specific.

Example:
> Your post has been scheduled for 10:00.

Only display this message after the operation has actually succeeded.

## 22. Design tokens

The following CSS provides a starting implementation. All components should consume these tokens rather than duplicating literal color values.

```css
:root {
  color-scheme: light;

  /* Brand */
  --brand-black: #111111;
  --brand-lime: #D7FF64;
  --brand-white: #FFFFFF;

  /* Light surfaces */
  --background: #F3F4F3;
  --surface: #FFFFFF;
  --surface-secondary: #F3F4F3;
  --surface-tertiary: #EDEFEF;

  /* Text */
  --text-primary: #111111;
  --text-secondary: #606568;
  --text-muted: #8A9399;

  /* Borders */
  --border: #E3E7E6;
  --border-strong: #C9CECC;

  /* Actions */
  --accent: #D7FF64;
  --accent-foreground: #111111;

  /* Semantic */
  --success-bg: #E5F5D8;
  --success-text: #315C20;
  --warning-bg: #FFF1CC;
  --warning-text: #795500;
  --error-bg: #FCE8E6;
  --error-text: #A12622;
  --info-bg: #E8EEFF;
  --info-text: #254A8A;

  /* Typography */
  --font-display: "Bricolage Grotesque", sans-serif;
  --font-body: "Figtree", sans-serif;

  /* Type scale */
  --text-xs: 12px;
  --text-sm: 14px;
  --text-md: 16px;
  --text-lg: 18px;
  --text-xl: 22px;
  --text-2xl: 28px;
  --text-3xl: 36px;
  --text-display: 48px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 80px;

  /* Radius */
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-2xl: 32px;
  --radius-pill: 999px;

  /* Borders */
  --border-width: 1px;

  /* Shadows */
  --shadow-card: 0 4px 16px rgba(17, 17, 17, 0.04);
  --shadow-floating: 0 8px 24px rgba(17, 17, 17, 0.08);

  /* Motion */
  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --duration-slow: 280ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);

  /* Layout and controls */
  --page-padding: 24px;
  --content-max-width: 1200px;
  --button-height: 52px;
  --input-height: 54px;
}
```

### 22.1 Dark theme tokens

```css
[data-theme="dark"] {
  color-scheme: dark;

  --background: #0A0A0A;
  --surface: #181A1B;
  --surface-secondary: #222526;
  --surface-tertiary: #2A2E30;

  --text-primary: #F5F5F5;
  --text-secondary: #C1C6C8;
  --text-muted: #929A9E;

  --border: #34383A;
  --border-strong: #505658;

  --accent: #D7FF64;
  --accent-foreground: #111111;

  --success-bg: #26351F;
  --success-text: #C4F5A0;
  --warning-bg: #3B3018;
  --warning-text: #FFD887;
  --error-bg: #402322;
  --error-text: #FFB4AD;
  --info-bg: #202C43;
  --info-text: #B7CCFF;

  --shadow-card: none;
  --shadow-floating: 0 8px 24px rgba(0, 0, 0, 0.24);
}
```

### 22.2 Base styling

```css
* {
  box-sizing: border-box;
}

html {
  background: var(--background);
}

body {
  margin: 0;
  background: var(--background);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--text-md);
  line-height: 1.5;
  transition:
    background-color var(--duration-normal) var(--ease-standard),
    color var(--duration-normal) var(--ease-standard);
}

h1,
h2,
h3,
h4 {
  font-family: var(--font-display);
  color: var(--text-primary);
  line-height: 1.15;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
}

:focus-visible {
  outline: 2px solid var(--text-primary);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 23. Reusable components

Create reusable components for at least:

- `BrandLogo`
- `PrimaryButton`
- `SecondaryButton`
- `IconButton`
- `TextInput`
- `PhoneInput`
- `TextArea`
- `LanguageSelector`
- `StatusPill`
- `PostCard`
- `HeroCard`
- `ImageUpload`
- `BottomNavigation`
- `SidebarNavigation`
- `BusinessSelector`
- `LoadingIndicator`
- `EmptyState`
- `ErrorState`
- `ConfirmationDialog`
- `ToastNotification`
- `ThemeSelector`

Each component must use centralized design tokens. Avoid duplicating theme-specific styles across individual screens.

### 23.1 Component variants

Expose only meaningful variants.

**Button:** primary, secondary, tertiary, destructive  
**StatusPill:** published, scheduled, needs-review, failed  
**TextInput:** default, focused, error, disabled

Avoid creating variants for arbitrary one-off visual differences.

## 24. Implementation rules

### 24.1 General

- Use semantic HTML.
- Use reusable components.
- Centralize design tokens.
- Keep styles consistent.
- Support light and dark themes.
- Implement responsive layouts.
- Provide accessible interaction states.
- Use real data when connected to a backend.
- Clearly separate mock data from production data.

### 24.2 Theme implementation

Use semantic tokens instead of hardcoded colors.

Avoid:
```css
background: #FFFFFF;
color: #111111;
```

Prefer:
```css
background: var(--surface);
color: var(--text-primary);
```

Brand-specific elements may use explicit brand tokens where needed.

### 24.3 Avoid

- Inconsistent corner radii
- Arbitrary spacing
- Unapproved brand colors
- Recreated logos
- Emoji icons
- Excessive gradients
- Heavy shadows
- Unnecessary animations
- Unreadable metadata
- Buttons without loading states
- Forms without validation
- Fake success messages
- Placeholder content presented as live data

### 24.4 Functional behavior

Visual implementation is not sufficient. Buttons must perform their intended actions, forms must validate input, upload controls must work, theme selection must persist, and navigation must lead to the correct destinations.

Publishing states must reflect actual application behavior.

## 25. Content states

Every major data-driven component should account for the following.

### Loading

Show an appropriate loading indicator or skeleton. Avoid flashing empty states while data is loading.

### Empty

Explain why no content is shown and provide a relevant next action.

### Success

Show confirmation after the operation succeeds.

### Error

Explain the problem and offer a recovery action when possible.

### Offline

Communicate unavailable functionality and preserve user input when possible.

### Permission denied

Explain which permission is required and how the user can proceed.

### Expired session

Provide a clear route to authenticate again.

### Partial failure

Preserve successfully completed work and explain which operation failed.

## 26. Quality assurance checklist

### Branding
- [ ] Original supplied logo is used.
- [ ] Logo proportions are preserved.
- [ ] No unauthorized logo modifications exist.
- [ ] Brand colors are consistent.
- [ ] Lime remains the primary action accent.

### Light mode
- [ ] Background and card hierarchy is clear.
- [ ] Text contrast is sufficient.
- [ ] Borders are subtle.
- [ ] Primary buttons are clearly visible.
- [ ] Disabled controls remain understandable.

### Dark mode
- [ ] Background is not uniformly pure black.
- [ ] Card surfaces are distinguishable.
- [ ] Text hierarchy remains clear.
- [ ] Lime buttons use black text.
- [ ] Borders remain visible.
- [ ] Semantic states remain distinguishable.
- [ ] Images remain natural.

### Typography
- [ ] Display and body fonts are consistent.
- [ ] Headings wrap correctly.
- [ ] Body text is readable.
- [ ] Metadata is not excessively small.
- [ ] Font weights establish hierarchy.

### Components
- [ ] Buttons support all required states.
- [ ] Inputs have labels.
- [ ] Validation messages are clear.
- [ ] Status pills include text.
- [ ] Upload controls work.
- [ ] Navigation is functional.
- [ ] Empty states are implemented.
- [ ] Error states are implemented.

### Responsive behavior
- [ ] Small mobile screens work.
- [ ] No horizontal overflow exists.
- [ ] Keyboard does not hide essential controls.
- [ ] Safe areas are respected.
- [ ] Tablet layout works.
- [ ] Desktop layout works.

### Accessibility
- [ ] Keyboard navigation works.
- [ ] Focus indicators are visible.
- [ ] Interactive controls have accessible names.
- [ ] Text contrast meets WCAG AA.
- [ ] Forms expose errors accessibly.
- [ ] Reduced-motion preferences are respected.
- [ ] Touch targets are sufficiently large.

### Functional behavior
- [ ] Forms validate correctly.
- [ ] Duplicate submissions are prevented.
- [ ] Loading states are accurate.
- [ ] Success messages reflect confirmed operations.
- [ ] Errors provide recovery options.
- [ ] Theme preferences persist.
- [ ] Mock data is not presented as live data.

## 27. Implementation priorities

### Phase 1: Foundation
1. Add the supplied logo asset.
2. Load Bricolage Grotesque and Figtree.
3. Implement design tokens.
4. Implement light and dark themes.
5. Establish responsive layout rules.

### Phase 2: Components
1. Buttons
2. Inputs
3. Language selector
4. Status pills
5. Cards
6. Navigation
7. Upload component
8. Loading and error states

### Phase 3: Screens
1. Signup
2. Client dashboard
3. Create-post screen

### Phase 4: Functionality
1. Form validation
2. Navigation behavior
3. Theme persistence
4. Photo upload
5. Post creation
6. Scheduling and publishing feedback
7. Error handling

Only implement integrations supported by the actual backend.

### Phase 5: Quality assurance
1. Test light mode.
2. Test dark mode.
3. Test responsive layouts.
4. Test accessibility.
5. Test form validation.
6. Test loading and error states.
7. Compare the implementation against the design system.
8. Fix inconsistencies before adding decorative details.

## 28. Agent implementation brief

Use this brief when assigning implementation work:

> Build a polished, responsive interface for Polar Marketing, an automated marketing service for small businesses in Tenerife.
>
> Use the user-provided logo as the authoritative brand asset. Do not recreate, approximate, distort, or replace it.
>
> Follow this design system: Scandinavian minimalism, playful brand personality, black-and-white structure, polar-lime accents, generous whitespace, bold Bricolage Grotesque headings, Figtree interface typography, rounded components, and subtle shadows.
>
> Implement both light and dark themes using centralized semantic design tokens. Use `#D7FF64` for primary actions and black text on lime backgrounds. Do not introduce blue or teal as primary brand colors.
>
> Build the signup screen, client dashboard, and create-post screen specified in this document. Use reusable components, responsive layouts, accessible controls, and explicit loading, success, empty, and error states.
>
> All controls must be functional rather than decorative. Use realistic Tenerife-related sample content only when backend data is unavailable, and clearly distinguish demo data from live data. Do not invent integrations or claim a post has been published unless the backend confirms it.
>
> Treat this document as the design-system source of truth. Do not reproduce incidental mockup artifacts or inconsistencies.

## 29. Final design principle

Polar Marketing must remain recognizable through a consistent combination of:

- The supplied logo
- Polar Black
- Snow White
- Polar Lime
- Bold, expressive headings
- Clean interface typography
- Rounded components
- Generous spacing
- Natural business photography
- Clear, accessible interactions

The interface should be minimal without feeling empty, playful without feeling childish, and professional without feeling corporate.

Light and dark mode must feel like two intentional expressions of the same brand.

When in doubt, prefer clarity, consistency, and simplicity.
