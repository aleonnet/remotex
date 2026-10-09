---
status: aceito
---

# Adendo ao design system: a área de transferência, os campos no toque, o alerta e os ícones de instalar

Adendo de 2026-10-10 (manhã) ao [design system](2026-10-03-0003-design-system.md), que continua em
vigor e não é reescrito. Vale este documento onde os dois diferem. Vem do adendo
[2026-10-10-0030](2026-10-10-0030-adendo-area-de-transferencia-e-campos.md), com a seção 3 refeita pelo plano
o alerta de desinstalar com marcadores;
os planos das outras seções são
a cara pública e os defeitos da 0.1.2,
e o desenho em vigor da folha da área de transferência é
a folha no celular,
que vale sobre a cena da área de transferência da
prancha.

## 1. A folha da área de transferência tem duas direções

A prancha desenha um cartão que esconde o texto do computador remoto atrás de um toque, um
campo que aparece ao tocar, e Enviar, Copiar e Colar juntos. Isso deixa de valer. A folha
tem duas partes, separadas por um fio, cada uma com o nome da direção:

- **No computador remoto.** O texto como está, numa caixa que não é campo (`.al-read`:
  seleção livre, quebra de linha preservada, no máximo 40% da altura da janela, com
  rolagem), e embaixo "{chars} caracteres, {lines} linhas". Um texto grande demais para
  transferir mostra o tamanho e a frase do catálogo (AL-6000) no lugar. O botão é "Copiar
  para este aparelho", que escreve a área de transferência deste navegador dentro do
  toque, e diz ao lado o que aconteceu (AL-6304 a AL-6307).
- **Deste aparelho.** Dois botões. "Enviar o que copiei aqui" lê a área de transferência
  deste aparelho dentro do toque e manda no mesmo ato (AL-6303, ou AL-6302 onde o
  computador não anunciou área de transferência); nada copiado é dito (AL-6310); uma recusa
  do navegador é dita (AL-6309) e abre o campo, para colar à mão. "Escrever…" é a única
  coisa que abre o campo, já com o foco, e com ele o Enviar comum (vazio: AL-6301).

Nada recebe foco ao abrir a folha além da própria folha, como toda folha faz: num celular,
abrir a área de transferência não sobe o teclado. O cartão "Toque para revelar" (AL-6100) e
o botão Colar não existem mais; a mesma folha vale em todo aparelho.

## 2. Os campos num aparelho de dedos têm 16 px

O corpo continua 15 px (`font.size.body`). Onde o apontador é um dedo (`pointer: coarse`),
todo campo e toda lista de escolha (`.al-input`, `.al-select`) têm
`max(16px, var(--al-font-size-body))`: o iOS amplia a página para focar um campo com fonte
menor que 16 px e não volta sozinho. É regra da folha de estilo, não do token, porque o
limiar é do aparelho, e o resto da página fica como está.

## 3. O alerta de desinstalar do app de Mac é uma lista com recuo

A prancha e o adendo do app desenham o alerta com um item por linha, e é assim que ele fica.
Um `NSAlert` quebra a continuação de uma linha do texto informativo sem recuo (foto do dono de
2026-10-08), e um parágrafo com tudo foi reprovado pelo dono ao instalar a 0.1.3 (2026-10-09):
então a abertura ("Isto apaga deste Mac:") fica no texto informativo e a lista vai numa vista
própria do alerta, um rótulo com quebra de linha e estilo de parágrafo próprio: cada item numa
linha, o marcador "•" na margem, o texto e a continuação de uma linha longa recuados 12 pontos,
e a frase do que fica depois da lista, com 6 pontos de espaço antes. A vista tem 340 pontos de
largura, mais que o texto do alerta (cerca de 300), para cada item caber em uma linha; a fonte é
a do sistema, de 13 pontos, a mesma do texto informativo. Os itens são os de sempre, e a
publicação no Tailscale entra quando há.

## 4. Os ícones de instalar são a marca

A página aponta um manifesto de app (`manifest.webmanifest`) com a marca
(`frontend/src/design/favicon.svg`) nos tamanhos 192 e 512, e `apple-touch-icon` em 180,
desenhados por `tools/product-icons.mjs` a partir do mesmo arquivo. O vidro da marca
(`color.brand.glass`) é a cor de fundo e a cor do tema no manifesto; a cor do tema na página
(`theme-color`) acompanha a superfície do tema escolhido. O logotipo que um servidor pode ter
continua só na aba: instalar é da marca.
