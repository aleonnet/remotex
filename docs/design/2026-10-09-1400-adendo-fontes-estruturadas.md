---
status: aceito
---

# Adendo ao design system: as fontes estruturadas dos textos e dos glifos

Adendo de 2026-10-09 (tarde) ao [design system](2026-10-03-0003-design-system.md), que continua em
vigor e não é reescrito. Vale este documento onde os dois diferem. Vem do plano
as fontes estruturadas e o repositório público,
por ordem do dono: a prancha é documentação e histórico, não insumo estrutural; as ferramentas
leem fontes estruturadas, e a prancha, se sair da árvore, não quebra nada.

## 1. As fontes

- **Os textos da interface** são [`words.json`](words.json): uma entrada por chave, com o texto
  em `pt-BR` e em `en-US` lado a lado, na ordem em que a prancha os tem (é a ordem dos dois
  dicionários da página, e mantê-la é o que os deixa iguais byte a byte). As 374 chaves de
  2026-10-09 vieram da prancha por extração; a partir daí, muda-se aqui.
- **Os glifos da página** são [`glyphs/`](glyphs/check.svg): um arquivo SVG por glifo, na grade
  de 24 pontos do Lucide, com a raiz do Lucide (`fill="none"`, `stroke="currentColor"`,
  `stroke-width="2"`, pontas e junções arredondadas) e dentro o desenho como a folha de origem o
  escreveu. São 42: 34 do Lucide, sob a [licença](icons/lucide-ISC.txt) que fica ao lado, e 8 do
  produto (`fit`, `mode-mirror`, `mode-virtual`, `one-to-one`, da lista de computadores;
  `second-bottom`, `second-left`, `second-right`, `second-top`, da segunda tela). Os glifos do
  app de Mac não estão aqui: o app usa os símbolos do sistema.
- **Quem lê as fontes:** `tools/product-words.py` (os dicionários da página),
  `tools/app-words.py` (o dicionário do app), `tools/product-glyphs.py` (`Glyph.tsx`),
  `tools/check-design.py` e `packaging/build-mac-dmg.sh` (a frase da janela da imagem de
  disco). Nenhum deles lê HTML.

## 2. A prancha é documento e consumidora

A prancha continua sendo onde um texto é lido, discutido e aprovado, e onde um glifo é
desenhado pela primeira vez: ela carrega uma cópia dos dois dicionários (os blocos
`al-i18n-pt-BR` e `al-i18n-en-US`) e dos glifos (`<symbol>`), e é por isso que funciona sem
rede. O que muda é o sentido da seta:

- `tools/mockup_sources.py --extract` promove o que a prancha carrega para as fontes: é o passo
  que se dá quando um texto ou um glifo novo foi aprovado nela.
- `tools/mockup_sources.py --refresh` devolve `words.json` aos dois blocos da prancha: é o passo
  que se dá quando um texto mudou na fonte.
- `tools/check-design.py` confere a prancha contra as fontes, chave a chave e glifo a glifo
  (um desenho é comparado sem espaço em branco: quinze glifos aparecem em duas folhas e
  diferem só por um espaço antes de `/>`). Uma deriva reprova com a chave ou o glifo nomeado.
- **Sem a prancha na árvore** (a cópia pública não a tem), `check-design.py` diz que pulou as
  conferências dela e passa; `tests/mockup/` pula os testes dizendo por quê; `refute-mockup.py`
  recusa rodar, com uma frase; `product-words.py --check`, `product-glyphs.py --check` e
  `app-words.py --check` conferem o mesmo de sempre. Nada gera, compila ou confere lendo a prancha.

## 3. O que deixa de valer

Onde um documento desta pasta ou um comentário de ferramenta diz que um texto ou um glifo "é o
da prancha" ou vem "do sprite da prancha" (era o que os cabeçalhos de `tools/product-words.py`,
`tools/app-words.py` e `tools/product-glyphs.py` diziam até 2026-10-09), leia-se: é o da fonte,
`words.json` ou `glyphs/`, de que a prancha carrega uma cópia conferida. A seção 7 do design
system (os glifos: significado, nome no Lucide, símbolo no Mac, e a regra de `currentColor` e
do nome para o leitor de tela) continua valendo como está.

## 4. Como se prova

Medido em 2026-10-09, ao trocar as cinco ferramentas da prancha para as fontes: os dois
dicionários da página saíram byte a byte iguais (`git diff --exit-code -- frontend/src/words`),
e `Glyph.tsx` e `Words.generated.swift` só mudaram nas linhas de comentário que nomeiam a fonte
nova. Cinco plantas provam que as conferências mordem: `13a` e `13b` em `tools/refute-mockup.py`
(um texto e um glifo derivados na prancha), e `words-source-edited`, `glyph-source-edited` e
`words-generated-edited` em `tools/refute-page.py` (uma fonte ou um gerado editado à mão).
