---
status: aceito (onde difere deste, vale o adendo 2026-10-06-2030-adendo-janelas-luz-e-disco.md, sobre as abas dos Ajustes, as janelas, a luz do menu e o ícone do disco)
---

# Adendo ao design system: o app de Mac como foi construído

Adendo de 2026-10-05 ao [design system](2026-10-03-0003-design-system.md), que continua em
vigor e não é reescrito. Vale este documento onde os dois diferem. É o que o
plano 2 mudou ao construir o app de Mac sobre a
prancha aprovada. O mecanismo de cada
coisa está em [mac-app.md](../mac-app.md).

A prancha não ganhou nem perdeu cena, e os tokens não mudam. O que ela não desenha está em
2026-10-05-0030-app-de-mac-pecas-novas.html,
que o dono aprovou em 2026-10-05, com uma condição: no macOS 26 e 27 o app tem de usar o
vidro de verdade.

## 1. O vidro, medido

O design system tem dois perfis para o app: com vidro no macOS 26 e 27, sem vidro no 14 e
no 15. O perfil é só a versão do sistema.

O que o sistema faz de vidro sozinho não é pedido. Medido no macOS 27.0.1, lendo as peças
que o sistema monta para uma janela de Ajustes feita como a do app: cada painel da barra do
alto fica sobre uma peça de vidro do próprio sistema (`NSGlassEffectView`). O menu da barra
de menus, um alerta e uma folha são do sistema, desenhados como ele os desenha.

Um botão não é vidro: desenhado fora da tela no mesmo sistema, sai retangular, de canto
pequeno, sem vidro nenhum. Por isso três coisas são pedidas pelo nome, só do macOS 26 em
diante:

- **todo botão é uma cápsula**, como a prancha desenha no perfil com vidro;
- **o aviso é uma faixa de vidro**, tingida com a cor de atenção, afastada das bordas da
  janela como um grupo de linhas. É o que a seção "Aviso do app" já dizia, e a prancha
  desenhava opaca;
- **o botão do aviso é um botão de vidro**, porque fica sobre vidro.

O conteúdo de um painel não pede vidro: a Apple reserva o vidro para o que fica por cima do
conteúdo. No macOS 14 e 15 as três coisas são o que a prancha desenha no perfil sem vidro: o
botão do sistema e a faixa opaca de borda a borda.

Dois limites. A aparência do vidro só o olho confere: a imagem tirada fora da tela não o
desenha. E não houve um Mac com macOS 14 ou 15 à mão: o perfil sem vidro sai por construção,
os mesmos controles sem nada pedido a eles.

O painel à esquerda da primeira vez continua sendo o "vidro apagado" da marca: uma cor
cheia, nos dois perfis, como a prancha desenha. É uma tela, e não um controle.

## 2. O ícone da barra de menus

Onde o design system diz "uma barra faltando: há um problema que pede ação", vale a
prancha: as três barras vazadas com um sinal ao lado. E há um quarto estado, que a prancha
não desenha: as três barras esmaecidas, quando o Alumia não está servindo nada (parado, sem
configurar ou ainda iniciando).

O menu é o do sistema (`NSStatusItem` com `NSMenu`), e não uma janela: é o que a Apple pede
de um item da barra de menus.

## 3. O menu, e o Alumia parado

Mudou depois do uso (seção 9): o que segue é o que vale.

O alto do menu são duas linhas que não se escolhem. A primeira diz o que o Alumia está
fazendo neste Mac, com um sinal ao lado; a segunda diz quem está conectado, ou o que falta.
O "Alumia" em letra menor, que encabeçava o menu, saiu.

- **O Alumia está rodando** (sinal verde), e embaixo "Ninguém conectado" ou "Conectado: o
  nome do computador". Só aparece com o servidor servindo de verdade.
- **O Alumia precisa de você** (âmbar), e embaixo a frase do aviso, com o botão que resolve.
- **Falta configurar o Alumia** (âmbar), com "Configurar…". Um Mac recém-instalado dizia
  "Pronto", que não era verdade.
- **O Alumia está iniciando…** (cinza).
- **O Alumia está parado** (cinza, um anel vazio), com "Ligar o Alumia".

O sinal é uma cor do sistema e nunca é o único sinal: a frase ao lado diz o mesmo.

"Parar o Alumia" aparece enquanto ele serve, e "Ligar o Alumia" só com ele parado. É um
estado só, o mesmo do interruptor "Alumia ligado" do painel Geral, que ficou no lugar de
"Manter rodando". Parado, a página fecha, a sessão aberta termina com a frase dela, o
endereço do Tailscale sai do ar e nada volta sozinho. "Abrir no navegador" e "Copiar o
endereço" ficam onde estão, desligados, porque não há página para abrir. "Abrir no
navegador" abre sempre o endereço deste Mac; "Copiar o endereço" copia o publicado.

E um caso que nenhum desenho tinha: o app precisando do dono com uma sessão aberta em outro
computador (uma sessão num Windows, com o Compartilhamento de Tela deste Mac desligado). O
menu mostra o botão que resolve o aviso e, logo abaixo, "Encerrar a sessão".

## 4. O FFmpeg

Sem o FFmpeg a tela deste Mac só abre em navegador que decodifica o vídeo do Mac. Enquanto
ele falta, num Mac que hospeda a própria tela, o app diz isso em três lugares, e cada um
instala:

- **o selo**, uma linha do painel Geral, com o estado (um sinal e uma palavra: "Não
  instalado", "Instalando…", "Instalado") e o botão. O selo fica até o servidor achar o
  FFmpeg;
- **o aviso**, a mesma faixa dos outros, com o botão "Instalar";
- **um item do menu**, "Instalar o FFmpeg…". O ícone da barra não pede o dono por isso: a
  tela abre sem ele.

Os três abrem uma folha só. Com o Homebrew, ela mostra o comando antes de rodar, roda, mostra
a última linha que o Homebrew disse e pode ser fechada com a instalação andando. Sem o
Homebrew, leva ao instalador oficial dele e espera, e continua sozinha quando ele aparece. A
barra de andamento não tem porcentagem: o Homebrew não diz quanto falta.

## 5. As duas folhas dos Ajustes

- **Computador.** "Editar…" em cada linha e "Adicionar computador…" sob a lista abrem a
  mesma folha: nome, tipo, endereço, porta, usuário e senha. Trocar o tipo troca a porta. Um
  Mac é um computador aqui e dois modos na página, Virtual e Espelhado. Neste Mac o nome, o
  tipo, o endereço e a porta não se mudam. Senha em branco mantém a guardada, e a folha só diz
  isso quando há uma guardada para tudo o que o salvamento grava. Um computador que muda de
  tipo é outro computador no lugar do antigo: a senha do antigo não vai junto. "Remover"
  pergunta antes, num alerta.
- **Senha da página.** "Alterar…" no painel Acesso abre a folha: usuário, senha nova,
  repetir. A folha avisa que a sessão aberta termina.

O que um campo recusa aparece sob o formulário, com o código, como mensagem do catálogo. O
que o servidor recusa aparece no mesmo lugar, na frase dele.

## 6. Remover

- O alerta de desinstalar ganha uma quinta linha quando a página está publicada no
  Tailscale: "a publicação no Tailscale que aponta para o Alumia".
- A frase sob "Desinstalar o Alumia" mudou. A da prancha dizia que arrastar o app para o
  Lixo não apaga nada; medido três vezes seguidas, o servidor acha o próprio app no Lixo em
  dez segundos e manda limpar os rastros. O app diz: "Levar o app para o Lixo só faz o mesmo
  com o Alumia rodando."
- O app não tem a tela de licenças de código aberto, por ordem do dono. As licenças vão no
  pacote, como arquivos.

## 7. A imagem de disco

Mudou depois do uso: a janela da imagem de disco é a da prancha. Fundo no vidro escuro da
marca, o app, uma seta no meio, a pasta Aplicativos, e uma frase só embaixo, em inglês,
porque a imagem é uma para todo mundo e o Finder escreve "Applications" ao lado do app em
qualquer idioma.

A primeira imagem saiu clara, com a frase nas duas línguas, e com o desenho pela metade num
canto. A metade era defeito do desenho na densidade dupla, e não do Finder; está consertado,
e a montagem reprova se voltar.

Três coisas dessa janela são do Finder, e não da imagem. Cada uma foi medida no macOS 27,
fotografando a janela como o Finder a desenha, ou lida na fonte:

- **Os dois nomes ficam em cápsulas claras.** Quem escreve "Alumia" e "Applications" é o
  Finder, e sobre um fundo que é da imagem ele os escreve em preto, também num Mac no tema
  escuro: sobre a figura, sobre a figura com a cor do registro da janela trocada para preto, e
  sobre uma cor escura sem figura nenhuma, as três fotografadas. Em claro, só numa janela sem
  fundo próprio, que não tem seta nem frase. Por isso a prancha, que desenha os nomes em claro
  sobre o vidro, não se cumpre nesse ponto: cada nome fica sobre uma cápsula clara, como os
  botões do app, e o que é claro sobre o vidro escuro são a seta e a frase.
- **Nada é desenhado nos últimos 60 pontos da janela.** Um Finder com a barra de caminho
  ligada a mostra no pé desta janela, por cima da figura: 32 pontos, medidos. A frase da
  primeira imagem escura ficou embaixo dela.
- **A janela não abre no meio de toda tela.** O registro de uma janela diz um lugar na tela,
  contado do canto inferior esquerdo, e mais nada; a ferramenta que o escreve diz que não há
  como posicionar em relação ao centro. O lugar escolhido põe o meio da janela a meio caminho
  entre o meio da menor tela de Mac à venda e o da maior: nas duas ela abre a uns 272 pontos do
  meio para um lado e a 121 para cima ou para baixo, e mais perto em todas as do meio.

## 8. A página: outros Macs com Alumia

Depois de "Seus computadores" vem "Outros Macs com Alumia", quando o servidor acha algum. Uma
linha por Mac: o monitor apagado, sem as três teclas, o nome que aquele Mac dá a si mesmo,
"Mac com Alumia" embaixo, e um ato só, "Ir para este Mac", que leva esta janela ao Alumia
daquele Mac. É um link, e não um botão, porque sai desta página. A dica da linha diz o que
acontece: lá se entra com a senha de lá.

## 9. Depois do uso

O dono instalou, usou e reprovou em uso, em 2026-10-05. O que mudou no desenho, além do menu
(seção 3) e da imagem de disco (seção 7):

- **Acesso.** O botão "Publicar" saiu. Com o Tailscale pronto e o Alumia ligado, o app
  publica sozinho, e a linha diz "publicando…"; no lugar do botão há um interruptor,
  "Acessível de outros aparelhos". Desligado, ou com o Alumia parado, a linha diz
  "desligado" e por quê. Na primeira vez a linha diz "pronto para publicar" e que a
  publicação acontece ao terminar. Com o servidor sem servir, a linha diz "pronto para
  publicar" e que publica assim que ele estiver servindo. Se o Tailscale não diz o que está
  publicado, a linha diz "sem resposta" e nada é publicado. Onde o endereço deste Mac no
  Tailscale já leva a outra coisa, a linha diz "em uso por outra coisa", para onde leva, e tem
  o único botão que sobrou, "Usar para o Alumia", que só aparece com o Alumia configurado,
  ligado, servindo e com o interruptor ligado.
- **Computadores.** Sobre a lista, e na folha de adicionar, uma frase diz para que serve:
  abrir pelo navegador um computador que não tem o Alumia, passando por este Mac.
- **Avançado.** Uma linha para o registro do servidor, com "Mostrar no Finder".
- **Avisos.** Um aviso novo, depois do Compartilhamento de Tela e antes do FFmpeg: o macOS
  não está deixando o Alumia alcançar a rede local, com o botão que leva aos Ajustes do
  Sistema e a frase que diz o caminho.
- **A página, no próprio Mac.** Com a página aberta no Mac que hospeda, a linha desse Mac
  fica no Espelhado, e a tecla do modo vira uma marca que diz por quê: "Espelhado. O Virtual
  fica desligado neste Mac: ele apagaria as telas que você está usando."
- **O teclado.** ⌘V, ⌘C, ⌘X, ⌘A e ⌘Z funcionam nos campos: o app ganhou o menu Editar, que
  num item da barra de menus não aparece.

O que só o olho confere: se o macOS mantém a primeira linha do menu na cor de rótulo (ela é
uma linha que não se escolhe, e o sistema desenha essas esmaecidas), e a cor dos nomes na
imagem de disco.
