# auto-theme-settings

## Purpose

Provide user-facing configuration for automatic theme detection. Includes a persistent config file for theme preferences, a `/theme-auto` slash command with an interactive settings menu, and theme selection dialogs for mapping dark/light detection results to concrete Pi themes.

## Requirements

### Requirement: Extension configuration file

The extension SHALL persist user preferences to `.pi/auto-theme-config.json` in the project root directory. The file SHALL contain: `enabled` (boolean, default `true`), `darkTheme` (string, default `"dark"`), and `lightTheme` (string, default `"light"`). The extension SHALL read this file on startup and write it on configuration changes.

#### Scenario: Default config when file missing

- **WHEN** `.pi/auto-theme-config.json` does not exist
- **THEN** the extension SHALL use defaults: `{ enabled: true, darkTheme: "dark", lightTheme: "light" }`

#### Scenario: Write on configuration change

- **WHEN** the user changes `darkTheme` to `"nord-dark"` via `/theme-auto`
- **THEN** the extension SHALL update the in-memory config and write `.pi/auto-theme-config.json`

#### Scenario: Read on startup

- **WHEN** the extension loads during `session_start`
- **THEN** the extension SHALL read `.pi/auto-theme-config.json` and use the stored values

### Requirement: /theme-auto slash command

The extension SHALL register a `/theme-auto` command via `pi.registerCommand()` that presents an interactive settings menu using `ctx.ui.select()` dialogs.

#### Scenario: Command registered

- **WHEN** the extension loads
- **THEN** `/theme-auto` SHALL appear in pi's command list with description "Configure automatic theme detection"

#### Scenario: Main menu displays current status

- **WHEN** the user types `/theme-auto`
- **THEN** a select dialog SHALL show:
  - Current auto-theme status (enabled/disabled indicator)
  - A toggle option to enable/disable auto-theme
  - Current dark theme selection
  - Current light theme selection
  - A "Detect now" option

#### Scenario: Toggle auto-theme

- **WHEN** the user selects the toggle option
- **THEN** the extension SHALL flip `config.enabled`
- **AND** if enabling, SHALL write `CSI ? 2031 h` and trigger detection
- **AND** if disabling, SHALL write `CSI ? 2031 l` and stop intercepting stdin
- **AND** SHALL save the updated config file

### Requirement: Dark theme selector

The `/theme-auto` menu SHALL provide a sub-dialog to select which theme to use when detection resolves "dark". The dialog SHALL list all available themes from `ctx.ui.getAllThemes()`, pre-selecting the current `config.darkTheme`.

#### Scenario: Select dark theme

- **WHEN** the user opens the dark theme selector from `/theme-auto`
- **THEN** a `ctx.ui.select()` dialog SHALL display all installed theme names
- **AND** the current `config.darkTheme` SHALL be pre-selected
- **AND** selecting a theme SHALL update `config.darkTheme` and save the config file
- **AND** if auto-theme is enabled and currently resolved to "dark", SHALL immediately apply the new theme

### Requirement: Light theme selector

The `/theme-auto` menu SHALL provide a sub-dialog to select which theme to use when detection resolves "light". The dialog SHALL list all available themes from `ctx.ui.getAllThemes()`, pre-selecting the current `config.lightTheme`.

#### Scenario: Select light theme

- **WHEN** the user opens the light theme selector from `/theme-auto`
- **THEN** a `ctx.ui.select()` dialog SHALL display all installed theme names
- **AND** the current `config.lightTheme` SHALL be pre-selected
- **AND** selecting a theme SHALL update `config.lightTheme` and save the config file
- **AND** if auto-theme is enabled and currently resolved to "light", SHALL immediately apply the new theme

### Requirement: Manual detection trigger

The `/theme-auto` menu SHALL provide a "Detect now" option that runs the full detection chain and applies the resolved theme, regardless of the `enabled` setting.

#### Scenario: Detect now

- **WHEN** the user selects "Detect now"
- **THEN** the extension SHALL run `detectColorScheme()`
- **AND** apply the resolved theme via `ctx.ui.setTheme()`
- **AND** show the result via `ctx.ui.notify()` (e.g., "Detected: dark → nord-dark")

### Requirement: Startup notification

When auto-theme is enabled and the extension loads, the extension SHALL notify the user of the detected scheme and applied theme via `ctx.ui.notify()`.

#### Scenario: Startup notification

- **WHEN** the extension detects "light" and applies "solarized-light" on startup
- **THEN** a notification SHALL appear: "Auto-theme: light → solarized-light"

### Requirement: Theme resolution function

The extension SHALL provide a `resolveTheme(darkOrLight, config)` function that returns the configured theme name for the given classification. For "dark" it SHALL return `config.darkTheme` (default `"dark"`). For "light" it SHALL return `config.lightTheme` (default `"light"`).

#### Scenario: Dark resolution with custom config

- **WHEN** `resolveTheme("dark", { darkTheme: "nord-dark", lightTheme: "light" })` is called
- **THEN** return `"nord-dark"`

#### Scenario: Light resolution with default

- **WHEN** `resolveTheme("light", { lightTheme: "light" })` is called
- **THEN** return `"light"`