/** Convert float PCM (`[-1, 1]`) to 16-bit PCM samples, clamping out-of-range input. */
export function floatToPcm16(samples: Float32Array, target = new Int16Array(samples.length)): Int16Array {
	for (let index = 0; index < samples.length; index++) {
		const clamped = Math.max(-1, Math.min(1, samples[index]!));
		target[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
	}
	return target;
}

/**
 * Encode 16 kHz mono PCM chunks as a 16-bit little-endian WAV file. Float chunks are
 * converted with {@link floatToPcm16}; `Int16Array` chunks are copied as-is.
 */
export function encodePcm16Wav(chunks: readonly (Float32Array | Int16Array)[], sampleRate = 16_000): Uint8Array {
	let sampleCount = 0;
	for (const chunk of chunks) sampleCount += chunk.length;

	const channelCount = 1;
	const bytesPerSample = 2;
	const dataBytes = sampleCount * bytesPerSample;
	const wav = new Uint8Array(44 + dataBytes);
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

	writeAscii(wav, 0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	writeAscii(wav, 8, "WAVE");
	writeAscii(wav, 12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
	view.setUint16(32, channelCount * bytesPerSample, true);
	view.setUint16(34, bytesPerSample * 8, true);
	writeAscii(wav, 36, "data");
	view.setUint32(40, dataBytes, true);

	// Every supported host is little-endian, so the Int16 view writes WAV byte order directly.
	const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, sampleCount);
	let offset = 0;
	for (const chunk of chunks) {
		if (chunk instanceof Int16Array) pcm.set(chunk, offset);
		else floatToPcm16(chunk, pcm.subarray(offset, offset + chunk.length));
		offset += chunk.length;
	}
	return wav;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
	for (let index = 0; index < text.length; index++) target[offset + index] = text.charCodeAt(index);
}

/** Decode a PCM16 mono WAV, including files with ancillary RIFF chunks. */
export function decodePcm16Wav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
	if (bytes.length < 12 || text(0) !== "RIFF" || text(8) !== "WAVE") throw new Error("Expected a PCM16 mono WAV");
	let sampleRate = 0;
	let data: Uint8Array | undefined;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		const start = offset + 8;
		if (start + size > bytes.length) throw new Error("Truncated WAV chunk");
		if (text(offset) === "fmt ") {
			if (
				size < 16 ||
				view.getUint16(start, true) !== 1 ||
				view.getUint16(start + 2, true) !== 1 ||
				view.getUint16(start + 14, true) !== 16
			)
				throw new Error("Expected a PCM16 mono WAV");
			sampleRate = view.getUint32(start + 4, true);
		}
		if (text(offset) === "data") data = bytes.subarray(start, start + size);
		offset = start + size + (size % 2);
	}
	if (!sampleRate || !data || data.length % 2) throw new Error("Invalid WAV audio");
	const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const samples = new Float32Array(data.length / 2);
	for (let i = 0; i < samples.length; i++) samples[i] = pcm.getInt16(i * 2, true) / 32768;
	return { samples, sampleRate };
}
