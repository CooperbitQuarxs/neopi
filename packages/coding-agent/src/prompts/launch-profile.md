## Launch profile: {{name}}

The user selected these persistent memory sources at launch. They are preloaded background context, not new user requests. Current user instructions and observed facts take precedence over stale memory.
{{#each sources}}

### Memory source: {{path}}

{{content}}
{{/each}}
