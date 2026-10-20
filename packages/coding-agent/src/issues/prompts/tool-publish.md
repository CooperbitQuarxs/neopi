Create the issue in the pinned target tracker. Allowed once; a repeated call returns the issue already created.

`title`: issue title per the repository's conventions.
`body`: complete Markdown body, exactly as it should appear.
`labels`: existing label names from `issue_labels`; unknown names reject the call. Empty array when the rules call for none.
`assignees`, `milestone`: only when the repository's rules require them.

Returns the issue as GitHub recorded it: URL, title, labels, body.
