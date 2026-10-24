import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { StreamingAudioPlayer } from "../tts/streaming-player";
import { EVENT_AUDIO_IDS, isStreamingCue, record } from "./events";
import { ownEventAudio } from "./activity";

const SAMPLE_RATE = 24_000;
const MAX_SECONDS = 10;
const MAX_FILES = 128;
const MAX_PCM_BYTES = 32 * 1024 * 1024;

export function expandAudioPath(value: string): string {
	return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}

interface Clip { samples: Float32Array; stamp: string; }
export interface EventSoundOptions {
	warning(message: string): void;
	blocked(): boolean;
	gain(): number;
	interval(): number;
	streamInterval(): number;
}

/** No playback queue: one clip at a time, excess frames are dropped rather than delayed. */
export class EventSoundPlayer {
	#mapping = new Map<string, Clip>();
	#cache = new Map<string, Clip>();
	#active: StreamingAudioPlayer | undefined;
	#releaseAudio: (() => void) | undefined;
	#priorityTimer: NodeJS.Timeout | undefined;
	#decoder: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;
	#loading: Promise<void> | undefined;
	#generation = 0;
	#loadingGeneration = 0;
	#enabled = false;
	#last = -Infinity;
	#lastStream = -Infinity;
	#lastById = new Map<string, number>();
	#warningKeys = new Set<string>();
	#played = 0;
	#dropped = 0;

	constructor(readonly options: EventSoundOptions) {}

	status(): string {
		return `${this.#enabled ? "on" : "off"} · ${this.#mapping.size} assigned events · ${this.#cache.size} decoded clips · ${this.#played} played · ${this.#dropped} dropped${this.#loading ? " · loading" : ""}`;
	}

	setEnabled(enabled: boolean): void {
		this.#enabled = enabled;
		if (!enabled) {
			this.#generation++;
			this.#decoder?.kill();
			this.#stop();
		}
	}

	#warn(key: string, message: string): void {
		if (this.#warningKeys.has(key)) return;
		this.#warningKeys.add(key);
		this.options.warning(`Event sounds: ${message}`);
	}

	reload(mappingPath: string): Promise<void> {
		if (this.#loading) {
			return this.#loadingGeneration === this.#generation
				? this.#loading
				: this.#loading.then(() => this.reload(mappingPath));
		}
		const generation = ++this.#generation;
		this.#loadingGeneration = generation;
		this.#stop();
		this.#warningKeys.clear();
		this.#loading = this.#load(expandAudioPath(mappingPath), generation).catch(error => {
			if (generation !== this.#generation) return;
			this.#mapping.clear();
			this.#cache.clear();
			this.#warn("mapping", `cannot load ${mappingPath}: ${String(error)}`);
		}).finally(() => { this.#loading = undefined; });
		return this.#loading;
	}

	async #load(mappingPath: string, generation: number): Promise<void> {
		const file = Bun.file(mappingPath);
		if (file.size > 2 * 1024 * 1024) throw new Error("mapping exceeds 2 MiB");
		const root = record(await file.json());
		const clips = record(root?.clips);
		if (root?.version !== 1 || !clips) throw new Error("expected {version:1, clips:{path:{status,events}}}");
		const archiveRoot = await fs.realpath(path.dirname(mappingPath));
		const assignments = new Map<string, string>();
		const ambiguous = new Set<string>();
		for (const [relative, value] of Object.entries(clips)) {
			const assignment = record(value);
			if (assignment?.status !== "assigned") continue;
			if (!Array.isArray(assignment.events) || assignment.events.some(id => typeof id !== "string")) {
				this.#warn(`schema:${relative}`, `invalid events for ${relative}; skipped`);
				continue;
			}
			if (!relative.startsWith("audio/") || relative.split("/").some(part => part === "..") || path.isAbsolute(relative)) {
				this.#warn(`path:${relative}`, `clip path must stay under this archive's audio/ directory; skipped ${relative}`);
				continue;
			}
			const absolute = path.resolve(archiveRoot, relative);
			for (const id of assignment.events as string[]) {
				if (!EVENT_AUDIO_IDS.has(id)) {
					this.#warn(`id:${id}`, `unsupported event ${id}; skipped (wake cues remain owned by voice settings)`);
					continue;
				}
				const previous = assignments.get(id);
				if (previous && previous !== absolute) ambiguous.add(id);
				else assignments.set(id, absolute);
			}
		}
		for (const id of ambiguous) {
			assignments.delete(id);
			this.#warn(`duplicate:${id}`, `multiple clips assigned to ${id}; leave exactly one to enable it`);
		}
		const selected = new Set(assignments.values());
		if (selected.size > MAX_FILES) throw new Error(`more than ${MAX_FILES} selected clips`);
		const cache = new Map<string, Clip>();
		let bytes = 0;
		for (const filename of selected) {
			if (generation !== this.#generation) return;
			try {
				const real = await fs.realpath(filename);
				const contained = path.relative(archiveRoot, real);
				if (!contained.startsWith(`audio${path.sep}`) || path.isAbsolute(contained)) throw new Error("clip resolves outside archive audio/");
				const source = Bun.file(real);
				const stat = await source.stat();
				if (!stat.isFile()) throw new Error("not a regular file");
				const stamp = `${stat.size}:${stat.mtimeMs}`;
				let clip = this.#cache.get(filename);
				if (clip?.stamp !== stamp) {
					const process = Bun.spawn(["ffmpeg", "-nostdin", "-v", "error", "-i", real,
						"-t", String(MAX_SECONDS + 0.01), "-f", "f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1"],
						{ stdin: "ignore", stdout: "pipe", stderr: "ignore" });
					this.#decoder = process;
					const timeout = setTimeout(() => process.kill(), 15_000);
					try {
						const [buffer, exit] = await Promise.all([new Response(process.stdout).arrayBuffer(), process.exited]);
						if (exit !== 0) throw new Error(`ffmpeg exited ${exit}`);
						if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) throw new Error("empty or corrupt audio");
						if (buffer.byteLength / 4 > SAMPLE_RATE * MAX_SECONDS) throw new Error(`clip exceeds ${MAX_SECONDS} seconds`);
						clip = { samples: new Float32Array(buffer), stamp };
					} finally {
						clearTimeout(timeout);
						if (this.#decoder === process) this.#decoder = undefined;
					}
				}
				bytes += clip.samples.byteLength;
				if (bytes > MAX_PCM_BYTES) throw new Error("selected PCM exceeds 32 MiB");
				cache.set(filename, clip);
			} catch (error) {
				if (generation !== this.#generation) return;
				this.#warn(`clip:${filename}`, `${filename}: ${String(error)}; skipped`);
			}
		}
		if (generation !== this.#generation) return;
		this.#cache = cache;
		this.#mapping = new Map();
		for (const [id, filename] of assignments) {
			const clip = cache.get(filename);
			if (clip) this.#mapping.set(id, clip);
		}
	}

	play(candidates: readonly string[]): void {
		if (!this.#enabled || this.#loading) return;
		const id = candidates.find(candidate => this.#mapping.has(candidate));
		if (!id) return;
		const now = performance.now();
		const stream = isStreamingCue(id);
		const interval = Math.max(100, Math.min(10_000, this.options.interval() || 250));
		const streamInterval = Math.max(interval, Math.min(60_000, this.options.streamInterval() || 1200));
		if (this.#active || this.options.blocked() || now - this.#last < interval ||
			(stream && now - this.#lastStream < streamInterval) || now - (this.#lastById.get(id) ?? -Infinity) < (stream ? streamInterval : interval)) {
			this.#dropped++;
			return;
		}
		this.#last = now;
		if (stream) this.#lastStream = now;
		this.#lastById.set(id, now);
		const player = new StreamingAudioPlayer();
		this.#active = player;
		this.#played++;
		// Voice starts preempt notification playback, including already queued native samples.
		this.#priorityTimer = setInterval(() => { if (this.options.blocked()) this.#stop(); }, 20);
		this.#priorityTimer.unref();
		this.#releaseAudio = ownEventAudio(() => this.#stop());
		const gain = this.options.gain();
		player.setGain(Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0.35);
		player.start(SAMPLE_RATE);
		player.write(this.#mapping.get(id)!.samples);
		void player.end().catch(error => this.#warn("playback", `playback failed: ${String(error)}`)).finally(() => {
			if (this.#active === player) this.#stop();
		});
	}

	#stop(): void {
		if (this.#priorityTimer) clearInterval(this.#priorityTimer);
		this.#priorityTimer = undefined;
		if (!this.#active) return;
		this.#active.stop();
		this.#active = undefined;
		this.#releaseAudio?.();
		this.#releaseAudio = undefined;
	}

	dispose(): void {
		this.setEnabled(false);
		this.#mapping.clear();
		this.#cache.clear();
	}
}
