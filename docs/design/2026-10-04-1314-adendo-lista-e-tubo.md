---
status: aceito
---

# Adendo ao design system: a lista de computadores e a tela de tubo

Adendo de 2026-10-04 ao [design system](2026-10-03-0003-design-system.md), que continua em
vigor e não é reescrito. Vale este documento onde os dois diferem. É o que a emenda 3 do
plano 1 mudou (plano, item 17), por ordem do
dono, depois de ele usar o produto e aprovar o desenho novo em três rodadas.

O desenho em vigor da lista é
2026-10-04-1245-lista-monitores.html. A cena
da lista na prancha fica como está, e os tokens não mudam.

## 1. A lista de computadores

Substitui o que o design system e a prancha dizem da lista e das opções de um computador.

- **Uma linha por computador, sobre o vidro da página.** Sem cartão: um fio entre as linhas.
  O nome vai na largura estreita, grande, e o título da página fica pequeno acima dele.
- **Um Mac listado nos dois modos é uma linha.** Dois alvos da configuração no mesmo
  endereço e na mesma porta, um em cada modo, viram uma linha sob o começo comum dos dois
  nomes. Outra porta no mesmo endereço é outro Mac, atrás de um túnel.
- **"Abrir" fica junto do monitor,** embaixo do nome, na faixa das teclas e da altura delas:
  o nome fica na altura da tela do monitor, e tudo o que se aperta numa linha fica numa faixa
  só. O resto da linha é da dica. (Ajuste do dono em 2026-10-04: na ponta direita da linha
  o botão ficava longe do que ele abre.)
- **Um monitor por linha, que é a janela em miniatura.** A tela dele mostra como a imagem
  chega: enchendo a janela; ajustada, com faixas onde as duas formas diferem; ou maior que a
  janela, com as barras de rolagem.
- **Três lugares na base do monitor, sempre os mesmos e na mesma ordem:** o modo (só num
  Mac), o tamanho, o som. Um lugar com outra escolha atrás é uma tecla: tem fundo, borda e
  cursor de apertar. Um sem escolha é uma marca: só o glifo, mais apagado. Um que não se
  aplica guarda o lugar vazio.
- **Sem frase na linha e sem "Opções".** O que cada glifo diz aparece numa dica, uma linha
  por glifo: com o ponteiro parado no monitor, com o foco do teclado numa tecla, e por 3,6 s
  depois de uma tecla ser apertada ou de um dedo tocar o monitor, que é como um dedo a vê,
  contados do último toque. "Abrir" é descrito pela dica, para o leitor de tela.
- **Os modos de um Mac chamam-se Virtual e Espelhado**, em todo o produto, e o selo "não
  oficial" não é mais usado.
  - Virtual: imagem e som vêm para cá; o Mac fica sem imagem e sem som.
  - Espelhado: espelha tudo, com o som perfeito.

## 2. Glifos próprios

O design system manda usar os glifos do Lucide. Quatro coisas da lista não têm desenho lá, e
são do produto, na mesma grade e no mesmo traço:

| Glifo | Diz |
|---|---|
| `mode-virtual` | Virtual: uma tela apagada atrás, uma acesa na frente |
| `mode-mirror` | Espelhado: as duas acesas |
| `fit` | o tamanho segue esta janela |
| `one-to-one` | o computador guarda o tamanho dele |

Moram no documento do desenho da lista, de onde `tools/product-glyphs.py` os lê. O som usa os
do Lucide: `volume-2` e `volume-x`.

## 3. Movimento

Substitui os itens 2 e 4 da seção 5 do design system ("acender" e "apagar"). A pesquisa está
em tela-de-tubo.

- **O monitor cresce.** "Abrir" faz a tela do monitor da linha crescer até ser a janela, em
  `duration.off`, e o nome do computador vai da linha para a placa no mesmo tempo.
- **Acender:** do centro da tela, igual para toda linha. Um ponto, o ponto se estica numa
  linha, a linha se abre na imagem com o vermelho à frente do verde e o verde à frente do
  azul, e o brilho sobe até `duration.igniteMax`.
- **Apagar:** a tela fecha por cima e por baixo até uma linha, e a linha se recolhe a um
  ponto, em `duration.off`. O que a imagem deixa ao se recolher é o vidro apagado, como ele é
  antes de uma sessão: a grade das três cores quase sem aparecer, e mais dela em volta do
  ponteiro. Nunca uma cor lisa. (Ajuste do dono em 2026-10-04.) Esse vidro, com o ponto no
  centro, some em mais `duration.off`, sobre a lista que voltou. Vale para "Encerrar" e para
  "Cancelar". "Encerrar" espera o apagar para pedir a lista, e a tela fica apagada até ela
  chegar. "Cancelar" pede a lista na hora, e a lista só aparece depois de a tela apagar; se
  a lista não vier, a placa volta com as palavras e com "Cancelar", sobre a tela apagada.
  Numa aba escondida nada é tocado, e nenhum dos dois espera por isso.
- **O convite a apertar:** a luz das três cores passa uma vez por trás de cada tecla quando a
  lista chega, e de novo na linha em que o ponteiro entra. É o único movimento da página que
  não responde a um gesto, e acontece uma vez.
- Com "reduzir movimento", nada disso se move, como já era a regra.

## 4. O que saiu da interface

Três escolhas que a lista oferecia deixaram de ser oferecidas. O motor continua com elas, e
o endereço da página as pede, como já pedia o decodificador por software:

| Saiu | Como se pede |
|---|---|
| Repassar o vídeo do Mac | `?passthrough=1` |
| Repassar o desenho do Windows | `?passthrough=1` |
| Som sem perdas | `?sound=lossless` |

Onde o servidor não decodifica o vídeo do Mac, ele continua repassando sozinho, e a dica da
linha diz isso.
