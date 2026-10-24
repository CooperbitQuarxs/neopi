/** Small shared seam: wake/manual capture can preempt notifications before opening their speaker/mic path. */
const notifications = new Set<() => void>();

export function eventAudioPlaying(): boolean {
	return notifications.size > 0;
}

export function ownEventAudio(stop: () => void): () => void {
	notifications.add(stop);
	return () => {
		notifications.delete(stop);
	};
}

export function preemptEventAudio(): void {
	for (const stop of [...notifications]) stop();
}
