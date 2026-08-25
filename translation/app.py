import asyncio
import os
from functools import lru_cache

import ctranslate2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from faster_whisper import WhisperModel
from huggingface_hub import snapshot_download
from sentencepiece import SentencePieceProcessor

SAMPLE_RATE = 16000
CHUNK_SECONDS = float(os.getenv("TRANSLATION_CHUNK_SECONDS", "3.0"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
TRANSLATION_MODEL = os.getenv("TRANSLATION_MODEL", "santhosh/madlad400-3b-ct2")
DEVICE = os.getenv("MODEL_DEVICE", "cpu")

LANGS = {
    "en": {"whisper": "en", "madlad": "en"},
    "fa": {"whisper": "fa", "madlad": "fa"},
}

app = FastAPI(title="Dayani Local Translation")


@lru_cache(maxsize=1)
def get_whisper():
    compute_type = "float16" if DEVICE == "cuda" else "int8"
    return WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=compute_type)


@lru_cache(maxsize=1)
def get_translator():
    model_path = snapshot_download(TRANSLATION_MODEL)
    tokenizer = SentencePieceProcessor()
    tokenizer.load(os.path.join(model_path, "sentencepiece.model"))
    translator = ctranslate2.Translator(
        model_path,
        device=DEVICE,
        compute_type="float16" if DEVICE == "cuda" else "int8",
    )
    return tokenizer, translator


def translate_text(text: str, target: str) -> str:
    tokenizer, translator = get_translator()
    target_tag = LANGS[target]["madlad"]
    tokens = tokenizer.encode(f"<2{target_tag}> {text}", out_type=str)
    result = translator.translate_batch(
        [tokens],
        beam_size=1,
        max_decoding_length=160,
        no_repeat_ngram_size=1,
        repetition_penalty=1.2,
    )[0]
    return tokenizer.decode(result.hypotheses[0]).strip()


def transcribe_and_translate(pcm_bytes: bytes, source: str, target: str) -> str:
    if source not in LANGS or target not in LANGS or source == target:
        return ""

    audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    if audio.size < SAMPLE_RATE // 2:
        return ""

    segments, _ = get_whisper().transcribe(
        audio,
        language=LANGS[source]["whisper"],
        vad_filter=True,
        beam_size=1,
        best_of=1,
        temperature=0.0,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    if not text:
        return ""

    return translate_text(text, target)


@app.get("/health")
def health():
    return {
        "ok": True,
        "whisper_model": WHISPER_MODEL,
        "translation_model": TRANSLATION_MODEL,
        "device": DEVICE,
        "languages": ["fa", "en"],
    }


@app.websocket("/ws")
async def translate_socket(websocket: WebSocket):
    source = websocket.query_params.get("source", "")
    target = websocket.query_params.get("target", "")
    if source not in LANGS or target not in LANGS or source == target:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    minimum_bytes = int(SAMPLE_RATE * CHUNK_SECONDS * 2)
    buffer = bytearray()

    try:
        while True:
            packet = await websocket.receive()
            if "bytes" not in packet or packet["bytes"] is None:
                continue
            buffer.extend(packet["bytes"])
            if len(buffer) < minimum_bytes:
                continue

            chunk = bytes(buffer)
            buffer.clear()
            translated = await asyncio.to_thread(transcribe_and_translate, chunk, source, target)
            if translated:
                await websocket.send_json({"type": "translation", "text": translated})
    except WebSocketDisconnect:
        return
