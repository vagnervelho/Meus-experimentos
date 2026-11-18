# -*- coding: utf-8 -*-
"""Catálogo completo de business cases (34 negócios). Edite casos_a.py e casos_b.py."""
from casos_a import CASOS_A
from casos_b import CASOS_B

CASOS = CASOS_A + CASOS_B
assert len({c["cod"] for c in CASOS}) == len(CASOS), "códigos repetidos"
assert len({c["aba"] for c in CASOS}) == len(CASOS), "abas repetidas"
assert all(len(c["aba"]) <= 31 for c in CASOS), "nome de aba com mais de 31 caracteres"
