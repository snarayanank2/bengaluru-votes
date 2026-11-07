"""Install the audit's fixed CMU dictionary; never download data during tests."""
import hashlib
import io
import os
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

REVISION = '550b6625bcef1f2abff2ff770a5a0d272c9c6b2a'
SHA256 = 'd07cca47fd72ad32ea9d8ad1219f85301eeaf4568f8b6b73747506a71fb5afd6'
with urlopen(f'https://raw.githubusercontent.com/nltk/nltk_data/{REVISION}/packages/corpora/cmudict.zip', timeout=30) as response:
    archive = response.read()
if hashlib.sha256(archive).hexdigest() != SHA256:
    raise RuntimeError('CMU dictionary checksum mismatch')
with ZipFile(io.BytesIO(archive)) as zipped:
    zipped.extractall(Path(os.environ['NLTK_DATA']) / 'corpora')
