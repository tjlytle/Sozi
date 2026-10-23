/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The run-settings block prepended to every session prompt, so the session reads the
// policy in words instead of guessing it.

const MERGE = {
    auto: "auto (QA merges when the gate is green; do not wait for a person)",
    review: "review (stop at approval; a person merges)"
};
const PLANS = {
    auto: "auto (proceed once the plan is posted; do not wait for a person)",
    review: "review (stop after posting the plan; a person approves it)"
};
const FINDINGS = {
    obvious:
        "obvious (file every finding as its own issue; an obvious one gets stage:todo and starts on its own, the rest get triage)",
    triage: "triage (file every finding as its own issue with the triage label)"
};

/** Builds the run-settings block.
 *
 * @param {{merge: string, plans: string, findings: string}} settings - The settings.
 * @param {{issue: number, stage: string, epic: number | null, until: string | null}} run - The run.
 * @returns {string} - The block, in Markdown.
 */
export function settingsBlock(settings, {issue, stage, epic, until}) {
    const lines = [
        "## Run settings",
        "",
        `- Issue: #${issue}`,
        `- Stage: ${stage}`,
        `- Merge: ${MERGE[settings.merge]}`,
        `- Plans: ${PLANS[settings.plans]}`,
        `- Findings: ${FINDINGS[settings.findings]}`
    ];
    if (epic) {
        lines.push(`- Epic: #${epic}`);
    }
    if (settings.backlog) {
        lines.push(
            `- Backlog: #${settings.backlog} (every issue you file goes here, not to the epic)`
        );
    }
    if (until) {
        lines.push(`- Until: ${until}`);
    }
    lines.push("- Outbox: /outbox");
    return lines.join("\n");
}

/** Renders a prompt template: replaces {N} with the issue number and prepends the block.
 *
 * @param {string} template - The template.
 * @param {{merge: string, plans: string, findings: string}} settings - The settings.
 * @param {{issue: number, stage: string, epic: number | null, until: string | null}} run - The run.
 * @returns {string} - The prompt.
 */
export function renderPrompt(template, settings, run) {
    return `${settingsBlock(settings, run)}\n\n${template.replaceAll("{N}", String(run.issue))}`;
}
