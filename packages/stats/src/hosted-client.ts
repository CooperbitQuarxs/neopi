/** Self-contained native app for sandboxed hosts. The host carries API traffic, never credentials. */
export async function createHostedStatsDocument(readAsset: (path: string) => Promise<Response>): Promise<Response> {
	const [html, script, css] = await Promise.all([
		readAsset("/index.html").then(response => response.text()),
		readAsset("/index.js").then(response => response.text()),
		readAsset("/index.css").then(response => response.text()),
	]);
	if (!/<script[^>]+src=["'](?:\/|\.\/)?index\.js["']/.test(html) || !css || !script ||
		css.startsWith("<") || script.startsWith("<")) throw new Error("Hosted stats client assets are incomplete");
	const policy = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
	const document = html
		.replace("<head>", `<head><meta name="neopi-stats-hosted" content="1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
		.replace(/<link[^>]+href=["'](?:\/|\.\/)?index\.css["'][^>]*>/, `<style>${css.replaceAll("</style", "<\\/style")}</style>`)
		.replace(/<script[^>]+src=["'](?:\/|\.\/)?index\.js["'][^>]*><\/script>/,
			`<script type="module" src="data:text/javascript;base64,${Buffer.from(script).toString("base64")}"></script>`);
	return new Response(document, { headers: {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Security-Policy": policy,
	} });
}
