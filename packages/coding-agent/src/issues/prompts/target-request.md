`/issue` request {{requestId}}. The operator's words, verbatim:

<operator-request>
{{prose}}
</operator-request>

Foreground: {{#if foregroundRepo}}`{{foregroundRepo}}` checkout `{{foregroundCwd}}`{{else}}`{{foregroundCwd}}` (no GitHub repository){{/if}}

<inventory>
{{#each repositories}}
- `{{repo}}`{{#if description}} — {{description}}{{/if}}{{#if flags}} [{{flags}}]{{/if}}{{#if checkouts}} · checkouts: {{checkouts}}{{else}} · no local checkout{{/if}}
{{/each}}
</inventory>
{{#if warnings}}

Inventory warnings:
{{#each warnings}}
- {{this}}
{{/each}}
{{/if}}
