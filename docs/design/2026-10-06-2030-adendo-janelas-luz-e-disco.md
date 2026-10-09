---
status: aceito
---

# Adendo ao design system: as janelas, a luz do menu e o ícone do disco

Adendo de 2026-10-06 ao [adendo do app de Mac](2026-10-05-0030-adendo-app-de-mac.md), que
continua em vigor e não é reescrito. Vale este documento onde os dois diferem. É o que mudou
no desenho do app depois de o dono instalar e usar, em dois consertos do mesmo dia:
a correção e
o conserto do vidro e da luz. O mecanismo
de cada coisa está em [mac-app.md](../mac-app.md), e as fontes nas duas pesquisas do dia
(uma,
outra).

A prancha e os tokens não mudam. Cada medida
abaixo foi copiada do código, que é nomeado ao lado.

## 1. O que deixa de valer do adendo anterior

Na seção 1 de lá ("O vidro, medido"), duas coisas:

- **A frase de que cada painel da barra do alto da janela de Ajustes fica sobre uma peça de
  vidro do próprio sistema.** No perfil com vidro as abas já não são a barra do sistema (seção
  5, abaixo). E aquilo tinha sido medido dentro do programa que roda os testes, lendo as peças
  que o sistema monta para uma janela nunca mostrada; na tela do dono a barra era chapada. O
  que uma janela parece não é o que um teste dela lê.
- **A conta de "três coisas pedidas pelo nome".** São cinco hoje (`Glass.swift`): as três de
  lá (todo botão uma cápsula, o aviso uma faixa de vidro, o botão do aviso um botão de vidro)
  e mais duas, a janela que mostra o que está atrás (seção 4) e a cápsula das abas (seção 5).
  E o que lá se diz do macOS 14 e 15, "o botão do sistema e a faixa opaca", ganha as outras
  duas: a janela opaca e a barra de abas do sistema.

O resto daquela seção continua: os dois perfis, as três coisas como estão descritas, e o
conteúdo de um painel sem vidro.

Na seção 9 de lá, o que "só o olho confere" sobre a primeira linha do menu já foi visto: ver a
seção 3, abaixo.

## 2. O visual é o do macOS em que o app roda

O sistema dá a um app o visual do kit com que o executável diz ter sido montado, e não o do
sistema em que ele roda. A primeira imagem do app dizia o kit do macOS 14 e abria no macOS 27
com o visual antigo, as abas dos Ajustes quadradas. A montagem passou a dizer o kit do Mac que
monta, lê o número de volta do executável e reprova qualquer outro
([mac-app.md, "Glass"](../mac-app.md#glass)).

## 3. O menu: a luz pede para ser vista

A luz ao lado da primeira linha do menu é a imagem dessa linha. Num app montado com o kit do
macOS 27, o sistema decide se mostra a imagem de uma linha de menu, e em geral esconde. Foi
assim que a luz sumiu no dia em que o app ganhou o visual novo. As duas linhas que dizem e não
se escolhem pedem que a imagem fique visível (`StatusItem.swift`, a função `said`): a
primeira, com a luz, e a de baixo, com uma imagem vazia do mesmo tamanho, para as duas frases
começarem no mesmo lugar.

A Apple escreve que em alguns casos o sistema ainda esconde, e não diz quais. Que a luz é
desenhada se vê no app, numa tela.

A primeira linha é pedida na cor de rótulo. No macOS 27 o sistema a desenha esmaecida mesmo
assim, como o menu do dono mostrou: é uma linha que não se escolhe, e a cor dela é do sistema.

## 4. As janelas mostram o que está atrás

No perfil com vidro (macOS 26 e 27), a janela de Ajustes e a da primeira vez deixam ver o que
está atrás delas. A receita é a do outro app de Mac da casa, lida no código dele, que o dono vê
funcionando nesses sistemas e deu como exemplo (`Glass.swift`):

- o fundo é o material do sistema que mistura o que está atrás da janela (`NSVisualEffectView`,
  material `hudWindow`, mistura `behindWindow`, sempre ativo);
- a janela não é opaca, tem fundo limpo, e o conteúdo vai por baixo de um título que não
  desenha nada de seu.

Uma janela que não é opaca não mostra nada onde nada é desenhado. Por isso o fundo cobre a
janela de ponta a ponta, o lugar do título incluído, e a janela não é mais alta que o que se
desenha nela.

- **Ajustes.** O fundo cobre a janela inteira, em cada um dos cinco painéis. O formulário de
  cada painel esconde o fundo próprio e fica sobre o da janela.
- **Primeira vez.** O passo, à direita, fica sobre esse fundo. O painel da marca, à esquerda,
  com 250 pontos de largura, continua a cor cheia, como a prancha desenha
  (`WizardView.swift`).

No perfil sem vidro (macOS 14 e 15) as duas janelas são opacas, como eram.

A janela da primeira vez tem 820 por 540 pontos nos dois perfis (`Windows.swift`). Antes, no
macOS 27, saía 32 pontos mais alta que o desenhado, com uma faixa no pé. O que a conserta (ela
deixa de contar a área que o sistema reserva ao título) vale nos dois perfis; no macOS 14 e 15
a altura não foi medida.

## 5. As abas dos Ajustes: uma cápsula de vidro, com uma bolha

No perfil com vidro, as abas são uma cápsula de vidro, uma só, sob o título da janela, como a
prancha desenha nesse perfil (`.am-panes`). Não são a barra de abas do sistema. No perfil sem
vidro continuam a barra do sistema.

As medidas (`PaneTabs`, em `SettingsView.swift`):

- cinco botões, cada um com 104 pontos de largura, 2 pontos entre eles e 4 em volta: a cápsula
  tem 536 pontos nas duas línguas e não muda de tamanho quando o idioma muda. O nome mais
  largo, "Computadores", mede 77 pontos na fonte do sistema a 11 pontos, e 81 em peso
  semibold;
- em cada botão, o símbolo sobre o nome: o símbolo a 17 pontos numa caixa de 20 de altura, o
  nome a 11 pontos;
- os símbolos, do sistema: engrenagem (Geral), tela (Computadores), cadeado (Acesso),
  controles deslizantes (Avançado), informação (Sobre);
- a janela guarda 68 pontos de altura para a cápsula, sob o título, e o painel começa embaixo
  dela.

A aba à mostra:

- tem por baixo uma **bolha**, uma cápsula na cor do rótulo a 14% de opacidade: mais clara que
  o vidro em volta no tema escuro, mais escura no claro;
- tem o símbolo e o nome na cor do rótulo, e o nome em peso semibold; as outras ficam na cor
  secundária, em peso normal;
- é dita como a escolhida a quem usa leitor de tela.

Ao escolher outra aba, a bolha **desliza** até ela, em 0,3 segundo, no movimento `snappy` do
sistema. Com "Reduzir movimento" ligado nos Ajustes do Sistema, a bolha troca de lugar sem
deslizar. A janela muda de nome e de altura para o painel escolhido.

A marca e o contraste são os do outro app da casa, lidos no código dele. A bolha é uma cápsula
tingida dentro da cápsula de vidro, e não um segundo vidro: o código daquele app anota que
formas de vidro vizinhas se fundem, e a bolha de lá, que o dono vê funcionando, é tingida.

A primeira versão desenhava uma cápsula dentro de cada painel. O dono a viu instalada: a aba à
mostra mal se distinguia, e a cada toque era marcada de novo, sem movimento, porque cada painel
desenhava a sua cápsula. Por isso é uma só, da janela.

## 6. Fora de Aplicativos, uma pergunta só

O app só é o app a partir de uma pasta Aplicativos, e um por vez. (O que ele roda sem janela
e a cópia de teste não passam por isto: [mac-app.md](../mac-app.md#only-from-applications-and-one-at-a-time)
conta.) Aberto de outro lugar (de
dentro da imagem de disco, de Transferências), ele faz uma pergunta num alerta do sistema e não
é mais nada: nenhum item na barra de menus ao lado do Alumia instalado.

- A frase é a do catálogo (`AL-1303`): "O Alumia precisa estar na pasta Aplicativos para
  continuar rodando."
- Os dois botões: **Mover para Aplicativos** e **Sair do Alumia**.

Aberto de Aplicativos com outro Alumia de Aplicativos já rodando, ele pede ao sistema que abra
aquele, e termina. Um Alumia aberto de novo, sem janela à vista, mostra os Ajustes, ou a
primeira vez enquanto o Alumia não está configurado, o que inclui o instante em que a
configuração ainda não foi lida (`main.swift`, `applicationShouldHandleReopen`); com uma janela
à vista, nada de novo. O caminho inteiro, e o que dele não foi estabelecido, está em
[mac-app.md](../mac-app.md#only-from-applications-and-one-at-a-time).

## 7. A imagem de disco veste um disco com o Alumia

Soma-se à seção 7 do adendo anterior, que trata da janela da imagem e continua valendo.

O ícone da imagem é o disco do próprio sistema com o ícone do Alumia por cima, reto e no meio
da face do disco, e não o ícone do app sozinho, que é do app. A montagem o desenha
(`packaging/macos/dmg-icon.swift`): o ícone do app ocupa 52% do lado da figura, com o centro a
meia largura e a 55,3% da altura, contada do pé, em todos os tamanhos que um ícone tem.

A imagem veste o ícone duas vezes: no volume montado, que é o que todo mundo vê e viaja com a
imagem; e no arquivo `.dmg`, que fica só na cópia daquele Mac e não viaja num download.

A ferramenta que monta a imagem tem uma opção pronta para isso, que inclina o ícone para trás e
o põe no alto do disco, sem ajuste para nenhuma das duas coisas. A primeira imagem com disco
foi feita com ela; o dono a viu e pediu o ícone reto e no meio.

## 8. O que vale em qual sistema

- Em todo sistema: o kit com que o app é montado (seção 2), a pergunta fora de Aplicativos
  (seção 6), o ícone da imagem de disco (seção 7) e o tamanho da janela da primeira vez.
- Só no macOS 27: o pedido de que a imagem das linhas do menu fique visível (seção 3). É onde
  o sistema passou a escondê-la.
- Só no perfil com vidro, macOS 26 e 27: as janelas que mostram o que está atrás (seção 4) e a
  cápsula das abas (seção 5).

## 9. O que só o olho confere

Os testes seguram que cada coisa é pedida, e mais nada: nenhum olha um pixel. A sessão que fez
este trabalho não pôde fotografar uma janela.

Visto pelo dono, no app instalado: que a luz tinha sumido; que a janela de Ajustes era opaca;
e, com a primeira imagem do conserto, que a janela de Ajustes mostrava o que está atrás, que a
cápsula estava lá, e os defeitos dela e do ícone que as seções 5 e 7 contam. Da janela da
primeira vez nenhum registro diz que alguém a tenha visto.

Visto por quem fez: o ícone, tirado do volume da imagem final e aberto como figura, reto e no
meio do disco.

Não visto por ninguém até a data deste adendo, na imagem final: a luz desenhada no menu, a
bolha deslizando, e o pé das duas janelas sem faixa vazia.

E não houve um Mac com macOS 14 ou 15 à mão: o perfil sem vidro sai por construção, e o lado
dele em cada teste nunca rodou.
