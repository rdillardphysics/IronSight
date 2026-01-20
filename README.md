# IronSight — TDOL's JFrog Xray Findings Viewer

IronSight is a native desktop app for viewing JFrog Xray container-scan findings in a simple, sortable, searchable interface.

## Contents

- [Release Version](#release-version)
- [Settings](#settings)
    - [Accessibility](#accessibility)
        - [Keyboard Navigation](#keyboard-navigation)
    - [App Theme](#app-theme)
    - [SSH Tunnel](#ssh-tunnel)
- [Opening a Vulnerabilities JSON](#opening-a-vulnerabilities-json)
- [Unloading a Vulnerabilities JSON](#unloading-a-vulnerabilities-json)
- [Sortable Columns](#sortable-columns)
- [Viewing Vulnerability Details](#viewing-vulnerability-details)
    - [Reference Links](#reference-links)
- [Filtering a Vulnerabilities JSON](#filtering-a-vulnerabilities-json)
    - [Filter Presets](#filter-presets)
    - [By Severity](#by-severity)
    - [By Package or CVEs](#by-package-or-cves)
    - [By Fixes Available](#by-fixes-available)
    - [By Whitelist](#by-whitelist)
    - [By Blacklist](#by-blacklist)
- [Clearing Filters](#clearing-filters)
- [Initiating a JFrog Xray Scan](#initiating-a-jfrog-xray-scan)
- [Currently Supported Vulnerabilities Schema](#currently-supported-vulnerabilities-schema)

### Release Version

v0.1.0

### Settings

#### Accessibility

By default, accessibility features are enabled. This includes keyboard navigation, focus traps to confine text and tab inputs to the current context, and modal interting to make the page behind the modal non-interactive.

- Click the wrench icon in the upper right of the app to open the Settings pop up.
- Click the toggle switch under the Accessibility features section to turn them on and off.

Back to [Contents](#contents)

##### Keyboard Navigation

- `b` → Open the Edit Filters pop up and focus on the Blacklist box
- `c` + `a` → Close all pop ups
- `c` + `f` → Clear the filters
- `c` + `v` → Clear the vulnerabilities table
- `f` → Open the Edit Filters pop up
- `j` → Open the JFrog Xray scan tool
- `o` → Open the file picker
- `p` → Focus on the path textbox
- `s` → Open the Settings
- `t` → Start the SSH tunnel
- `w` → Open the Edit Filters pop up and focus on the Whitelist box
- `/` → Open the Edit Filters pop up and focus on the Search box
- `↑` and `↓` → Navigate up and down the vulnerabilities table
- `esc` → Close top-level pop up

Back to [Contents](#contents)

#### App Theme

Toggle between Dark and Light modes by clicking the switch in the top right of the app.

Back to [Contents](#contents)

---

#### SSH Tunnel

- Click the wrench icon in the upper right of the app to open the Settings pop up.
- Enter an `IP/Host` (required), a `Username` (required), and a `Password` (optional).
    - The password will be saved locally in a vault.
- Click the Save button to store the SSH settings.
    - If the password was provided, the app will indicate so and vice versa.
- Exit the Settings pop up and click the SSH button next to the Settings button to start or stop the SSH tunnel.

**Note**: In order to remove the stored password, click the Clear Password button.

Back to [Contents](#contents)

---

### Opening a Vulnerabilities JSON

There are two options for opening a `vulnerabilities` schema:

1. Paste a path into the textbox and click the path icon button.
2. Click the folder icon button to open a file picker.

Once either method has accepted a supported `vulnerabilities` schema, the app will transform it into a human-friendly view by listing all of the findings in a sortable, individually clickable list.

**Note**: See the [Currently Supported Vulnerabilities Schema](#currently-supported-vulnerabilities-schema) section for a detailed description of a valid schema.

Back to [Contents](#contents)

---

### Unloading a Vulnerabilities JSON

Click the sweep icon button to unload the current file and return to this help screen.
Back to [Contents](#contents)

---

### Sortable Columns

Clicking the following column headers in the Vulnerabilities table will sort ascending and descending:
- Severity
- CVEs
- Package

Back to [Contents](#contents)

---

### Viewing Vulnerability Details

Click or navigate the Vulnerabilities table with the `up` and `down` arrows and hit `Enter` - see [Keyboard Navigation](#keyboard-navigation) - on any of the Vulnerabilities to open a pop up to view further details. This includes, if provided, a description of the vulnerability, clickable [Reference Links](#reference-links), and metadata which includes the impact paths, impacted package type, and severity as determined by JFrog.

Back to [Contents](#contents)

---

#### Reference Links

Reference links in the details panel open in the system's default browser.

Back to [Contents](#contents)

---

### Filtering a Vulnerabilities JSON

Use the filters to narrow results by clicking the Edit filters icon button or pressing `f`, if keyboard shortcuts are enabled - see [Keyboard Navigation](#keyboard-navigation).  Once the desired filters have been set, click the Apply filters button in the bottom right of the Edit Filters pop up.

Back to [Contents](#contents)

---

#### Filter Presets

1. Select the desired presets from the "Edit Filters" pop up.
2. Enter a descriptive name in the Preset name textbox.
3. Click the Save preset button (attached to the Preset name textbox).

Once a preset has been saved, it'll appear in the preset dropdown menu. Select a preset from this menu and click the Load selected preset button.

Back to [Contents](#contents)

---

#### By Severity

There is a Show All toggle button that is defaulted to show all vulnerability severities.  In order to change this:

1. Click the Show All toggle switch to turn off the default setting.
2. Select the desired severities to view.

**Note**: Clear this individual filter by clicking the Reset Severity filter button.

Back to [Contents](#contents)

---

#### By Package or CVEs

Use the Search textbox to filter by package or CVE.

**Note**: Clear this individual filter by clicking the Reset Search button.

Back to [Contents](#contents)

---

#### By Fixes Available

Hit this checkbox to only show vulnerabilities that have fix versions noted for the affected package.

**Note**: Clear this individual filter by clicking the Reset Fix filter button.

Back to [Contents](#contents)

---

#### By Search

There are three (3) options for searching here:

- Literal - Exact matching only of substrings → `open` will return `openssl`
- Fuzzy - Approximate strings will return results → `opns` will still return `openssl`
- Regex - Utilize special tokens to find complex structures in substrings → `.` will return everything, while `op` will only return vulnerabilities with the "op" substring.

Back to [Contents](#contents)

---

#### By Whitelist

Create a list of whitelist rules to include only the vulnerabilities that match them.

These can be scoped with a field, such as trying to only view the openssl package like this:

`package:openssl`

Or using literal substrings.

Back to [Contents](#contents)

---

#### By Blacklist

Create a list of blacklist rules to exclude the vulnerabilities that match them.

These can be scoped with a field, such as trying to exclude the openssl package like this:

`package:openssl`

Or using literal substrings.

Back to [Contents](#contents)

---


### Clearing Filters

Click the Clear filters button next to the Edit filters button or using a keyboard shortcut chord: `c` + `f`.

Back to [Contents](#contents)

---

### Initiating a JFrog Xray Scan

***Coming Soon***

Back to [Contents](#contents)

---

### Currently Supported Vulnerabilities Schema

**Note**: Key/value pairs outside of the `vulnerabilities` dictionary are not currently read and do not affect the supported status of the schema.

```json
{
    "vulnerabilities": {
        {
            "severity": "",
            "impactedPackageName": "",
            "impactedPackageVersion": "",
            "impactedPackageType": "",
            "components": [
                {
                    "name": "",
                    "version": "",
                    "location": {
                    "file": ""
                    }
                }
            ],
            "summary": "",
            "applicable": "",
            "fixedVersions": "",
            "cves": [
                {
                    "id": "",
                    "cvssV3": "",
                    "cvssV3Vector": "",
                    "cwe": [""]
                }
            ],
            "issueId": "",
            "references": [
                ""
            ],
            "impactPaths": [
                [
                    {
                        "name": "",
                        "version": ""
                    },
                    {
                        "name": "",
                        "version": "",
                        "location": {
                            "file": ""
                        }
                    }
                ]
            ],
            "jfrogResearcInformation": {
                "severity": ""
            }
        }
    }
}
```

Back to [Contents](#contents)
