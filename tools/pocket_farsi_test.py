import importlib.util
import os
import re
from pathlib import Path

import numpy as np
import scipy.io.wavfile
import torch
from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer, T5ForConditionalGeneration
from pocket_tts import TTSModel

OUT = Path("pocket-test-output")
OUT.mkdir(exist_ok=True)

MODEL_REPO = "mehdi-hf/pocket-tts-farsi-v2"
G2P_REPO = "mehdi-hf/Homo-GE2PE-Persian-HF"

segments = [
    ("امروز لازم نیست با عجله، روزم را شروع کنم.", 0.30),
    ("می‌توانم چند لحظه آرام بمانم، نفس بکشم، و اجازه بدهم ذهنم از شتاب فاصله بگیرد.", 0.35),
    ("برای فرصت تازه‌ی امروز، برای سلامتی، و برای توانایی فکر کردن و ساختن، سپاسگزارم.", 0.35),
    ("قرار نیست همه چیز همین حالا کامل باشد.", 0.30),
    ("کافی است با آرامش بیشتر، دقت بیشتر، و ذهنی روشن‌تر، قدم بعدی را درست بردارم.", 0.35),
    ("امروز انرژی‌ام را برای چیزهایی نگه می‌دارم که واقعاً ارزش دارند.", 0.30),
    ("با قدردانی شروع می‌کنم، با آرامش ادامه می‌دهم، و با عمل کردن می‌سازم.", 0.0),
]

normalize_path = hf_hub_download(MODEL_REPO, "normalize_fa.py")
spec = importlib.util.spec_from_file_location("normalize_fa", normalize_path)
normalize_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalize_mod)
normalize_for_model = normalize_mod.normalize_for_model

tok = AutoTokenizer.from_pretrained(G2P_REPO)
g2p = T5ForConditionalGeneration.from_pretrained(G2P_REPO).eval()

TO_PHONEMES = str.maketrans({"/": "a", "a": "A", "@": "?", "$": "S", "c": "C"})

def phonemise(text: str) -> str:
    text = normalize_for_model(text)
    text = text.replace("؟", "").replace("?", "")
    enc = tok([text], add_special_tokens=False, return_tensors="pt")
    with torch.no_grad():
        out = g2p.generate(**enc, num_beams=5, max_length=512, early_stopping=True)
    raw = tok.batch_decode(out, skip_special_tokens=True)[0].strip()
    return raw.translate(TO_PHONEMES).replace("1", "")

tts_model = TTSModel.load_model(MODEL_REPO)

female_prompt = hf_hub_download(
    MODEL_REPO,
    "samples/prompt_news_paragraph.wav",
)
voice_state = tts_model.get_state_for_audio_prompt(female_prompt, truncate=True)

pieces = []
for text, pause_s in segments:
    ph = phonemise(text)
    audio = tts_model.generate_audio(voice_state, ph).detach().cpu().numpy().astype(np.float32)
    pieces.append(audio)
    if pause_s > 0:
        pieces.append(np.zeros(int(tts_model.sample_rate * pause_s), dtype=np.float32))

final = np.concatenate(pieces)
peak = np.max(np.abs(final))
if peak > 0.98:
    final = final / peak * 0.98

scipy.io.wavfile.write(
    OUT / "pocket-farsi-male-news-voice-test.wav",
    tts_model.sample_rate,
    final,
)
print("saved", OUT / "pocket-farsi-female-test.wav", "seconds", len(final)/tts_model.sample_rate)
