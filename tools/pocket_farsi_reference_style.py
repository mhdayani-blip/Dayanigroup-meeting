import importlib.util
from pathlib import Path

import numpy as np
import scipy.io.wavfile
import torch
from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer, T5ForConditionalGeneration
from pocket_tts import TTSModel

OUT = Path("pocket-reference-output")
OUT.mkdir(exist_ok=True)

MODEL_REPO = "mehdi-hf/pocket-tts-farsi-v2"
G2P_REPO = "mehdi-hf/Homo-GE2PE-Persian-HF"

segments = [
    ("صبح بخیر.", 0.85),
    ("یه صبح تازه شروع شده.", 0.65),
    ("امروز لازم نیست با عجله روزم رو شروع کنم.", 0.75),
    ("چند لحظه آروم می‌مونم و یه نفس عمیق می‌کشم.", 1.00),
    ("برای سلامتی، برای فرصت تازه امروز، و برای توانایی فکر کردن و ساختن، سپاسگزارم.", 0.85),
    ("امروز رو با قدردانی شروع می‌کنم.", 0.65),
    ("و با آرامش ادامه می‌دم.", 0.0),
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

tts_model = TTSModel.load_model(config=f"hf://{MODEL_REPO}/model.yaml")
prompt = hf_hub_download(MODEL_REPO, "samples/prompt_news_paragraph.wav")
voice_state = tts_model.get_state_for_audio_prompt(prompt, truncate=True)

pieces = []
for text, pause_s in segments:
    ph = phonemise(text)
    print(text, "=>", ph)
    audio = tts_model.generate_audio(voice_state, ph).detach().cpu().numpy().astype(np.float32)
    pieces.append(audio)
    if pause_s:
        pieces.append(np.zeros(int(tts_model.sample_rate * pause_s), dtype=np.float32))

final = np.concatenate(pieces)
peak = np.max(np.abs(final))
if peak > 0.98:
    final = final / peak * 0.98

path = OUT / "pocket-farsi-reference-style.wav"
scipy.io.wavfile.write(path, tts_model.sample_rate, final)
print("saved", path, "seconds", len(final)/tts_model.sample_rate)
