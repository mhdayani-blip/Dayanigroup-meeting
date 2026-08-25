import asyncio
import os
from functools import lru_cache

import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from faster_whisper import WhisperModel
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

SAMPLE_RATE = 16000
CHUNK_SECONDS = float(os.getenv("TRANSLATION_CHUNK_SECONDS", "3.0"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
NLLB_MODEL = os.getenv("NLLB_MODEL", "facebook/nllb-200-distilled-600M")
DEVICE = os.getenv("MODEL_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")

LANGS = {
    "en": {"whisper": "en", "nllb": "eng_Latn"},
    "fa": {"whisper": "fa", "nllb": "pes_Arab"},
}

app = FastAPI(title="Dayani Local Translation")


@lru_cache(maxsize=1)
def get_whisper():
    compute_type = "float16" if DEVICE == "cuda" else "int8"
    return WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=compute_type)


@lru_cache(maxsize=1)
def get_nllb():
    tokenizer = AutoTokenizer.from_pretrained(NLLB_MODEL)
    model = AutoModelForSeq2SeqLM.from_pretrained(NLLB_MODEL)
    model.to(DEVICE)
    model.eval()
    return tokenizer, model


def transcribe_and_translate(pcm_bytes: bytes, source: str, target: str) -> str:
    if source not in LANGS or target not in LANGS or source == target:
        return ""

    audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    if audio.size < SAMPLE_RATE // 2:
        return ""

    whisper = get_whisper()
    segments, _ = whisper.transcribe(
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

    tokenizer, model = get_nllb()
    tokenizer.src_lang = LANGS[source]["nllb"]
    encoded = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
    encoded = {key: value.to(DEVICE) for key, value in encoded.items()}
    target_id = tokenizer.convert_tokens_to_ids(LANGS[target]["nllb"])

    with torch.inference_mode():
        generated = model.generate(
            **encoded,
            forced_bos_token_id=target_id,
            max_new_tokens=160,
            num_beams=1,
        )
    translated = tokenizer.batch_decode(generated, skip_special_tokens=True)[0].strip()
    return translated


@app.get("/health")
def health():
    return {
        "ok": True,
        "whisper_model": WHISPER_MODEL,
        "translation_model": NLLB_MODEL,
        "device": DEVICE,
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
