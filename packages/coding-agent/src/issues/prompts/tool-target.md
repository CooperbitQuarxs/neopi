Select the repository this `/issue` request belongs to; ends your part of the work.

`repo`: inventory entry, exactly as listed (`OWNER/REPO` or `HOST/OWNER/REPO`).
`reason`: the operator's words that identify it, and any nickname you mapped.

Rejected when the repository is not in the inventory, has issues disabled, or has no local checkout whose remote matches. Relay a rejection to the operator; NEVER retry with a different repository.
