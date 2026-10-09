# Registro de mudanças

[English](CHANGELOG.md) · Português

O que mudou no alumia que alguém usando notaria, do mais novo para o mais
antigo. O formato é o [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

O alumia numera as próprias versões, a partir da 0.1.0. O número se lê como o
[versionamento semântico](https://semver.org/) lê uma versão que
começa com zero: nada é prometido de uma versão para a seguinte, e não há
compatibilidade entre elas. O que uma versão pode mudar ou tirar é aquilo de que
você depende: uma chave de configuração do `alumia.toml`, uma opção da linha de
comando, o que o endereço da página pede (`?passthrough=1`, `?sound=lossless`),
o protocolo do WebSocket ou um recurso, sem nada que leia a forma antiga.
Confira o seu arquivo contra o [`alumia.example.toml`](alumia.example.toml) ao
atualizar. Até a 0.1.0 o número era o do remotex, o projeto de onde o alumia
veio.

## Unreleased

Nada ainda.

## 0.1.3 - 2026-10-09

Tudo desde que o alumia saiu do [remotex](https://github.com/andrewtheguy/remotex),
na versão 0.0.325, com o que o remotex fez até a 0.0.364 trazido para cá: a
primeira versão publicada, em
[github.com/aleonnet/alumia](https://github.com/aleonnet/alumia/releases/tag/v0.1.3),
com a imagem de disco do app de Mac anexada.

### Added

- **Instalar a página.** O documento aponta um manifesto de app, com a marca
  como ícone: o Chrome e o Edge oferecem *Instalar*, o iPhone *Adicionar à
  Tela de Início* com o ícone certo, e a página instalada abre sem a barra do
  navegador.
- **Uma página pública e um README novo,** os dois montados do próprio
  produto: a página que o servidor serve, mostrada ao vivo, a tela que acende
  ao rolar, e as telas do app de Mac desenhadas do código dele. A página é
  `site/`, publicada pelo GitHub Pages em
  [aleonnet.github.io/alumia](https://aleonnet.github.io/alumia/); o README
  mostra o produto nos dois temas e nos dois idiomas.
- **O modo Espelhado de um Mac** (`subtype = "ard-mirror"`): as telas do
  próprio Mac, que continuam acesas, com a imagem e o som pelo fluxo de mídia
  do Mac, sempre ajustadas à janela de quem vê, ou à tela de um celular, que
  não tem janela. Num Mac com mais de uma tela, mostra a principal. Não é oficial, e foi medido no macOS 27 com uma tela e
  com duas.
- **Uma interface própria**, desenhada a partir de um design system: um
  arquivo de tokens, dois temas (claro e escuro, ou o do sistema) e dois
  idiomas (Português e English), escolhidos na engrenagem.
- **Mensagens com código.** O que dá errado é dito numa frase com um código
  para citar (`AL-1001`), de um catálogo só, e uma falha de mídia diz a causa
  onde ela acontece.
- **Manter conectado neste navegador:** um login que o servidor guarda por
  trinta dias e que sobrevive a um reinício. A entrada também é entregue ao
  gerenciador de senhas do navegador.
- **Seus computadores:** uma linha por computador, com um monitor que mostra
  como a imagem vai chegar e teclas que escolhem o modo do Mac, o tamanho e o
  som. Um Mac listado nos dois modos, no mesmo endereço e na mesma porta, é
  uma linha só. O Mac em que o próprio servidor roda aparece na lista, e a
  sessão dele é chamada, pelo nome que esse computador dá a si mesmo.
- **A tela que acende** entre a lista e a imagem, ligando e desligando como um
  tubo, e uma tela que diz de quem é a sessão quando ela não é desta página,
  com a única coisa a fazer.
- **A barra da sessão**, pendurada numa alça: tela cheia, telas, silenciar, o
  teclado na tela, a área de transferência, a câmera e o microfone, a folha de
  informações e as preferências.
- **Um teclado na tela** que é uma janela no computador e no tablet, com Caps
  Lock e as teclas de função, e fica preso embaixo no celular, em duas telas da
  mesma altura: uma faixa sempre presente com Tab, Esc, Ctrl, Alt, Super e as
  setas, os símbolos com Shift como teclas próprias, e uma chave Sticky que
  deixa uma modificadora sair sozinha. A tecla sai quando o dedo levanta,
  mostrada acima do dedo e corrigida escorregando para a vizinha; um toque entre
  duas teclas vale a mais próxima; só as teclas de edição e de cursor repetem
  enquanto seguradas; e um dedo parado numa modificadora a segura para todas as
  teclas digitadas enquanto isso.
- **O medidor de vazão** como página, pela lista, e como folha, numa sessão.
- **"Não dá para começar"**, quando a página é aberta num endereço que não é
  seguro ou num navegador sem os decodificadores, com as saídas.
- **Um app de Mac** (Apple Silicon, macOS 14 ou mais novo) que hospeda o
  servidor e é o controle dele, e não mostra tela remota. Toma o visual do
  macOS em que roda, e no macOS 26 e no 27 as janelas dele deixam ver o que
  está atrás delas e as abas dos ajustes são uma cápsula de vidro. Ele se
  instala arrastando, de uma imagem de disco assinada e notarizada que leva o
  disco do sistema com o ícone do Alumia por cima; leva o dono pela
  primeira vez: manter rodando, o Compartilhamento de Tela, a conta deste Mac,
  de onde acessar, a senha da página; mantém o servidor rodando como um serviço
  do sistema; e diz na barra de menus, em duas linhas com um sinal ao lado da
  primeira, o que o servidor está fazendo neste Mac e quem está conectado. Veja
  [The Mac app](docs/mac-app.md).
- **"Parar o Alumia" e "Ligar o Alumia",** no menu do app e como o interruptor
  do painel Geral: parado, a página fecha, a sessão aberta termina dizendo
  isso, o que está publicado no Tailscale sai do ar, e nada volta sozinho, nem
  depois de reiniciar. "Encerrar a sessão" também está no menu.
- **Um Alumia mais novo arrastado por cima do instalado** percebe, ao ser
  aberto, que o servidor rodando é o do antigo, e com ninguém conectado
  desregistra o serviço dele e registra de novo; e o app registra a própria
  abertura no início da sessão, que é o que mostra o item da barra de menus,
  sem ninguém desligar e ligar "Mostrar na barra de menus". Nenhum dos dois foi
  ainda conferido de ponta a ponta num Mac
  ([The Mac app](docs/mac-app.md#the-service)).
- **Aberto de fora da pasta Aplicativos,** da imagem de disco por exemplo, o app
  pergunta uma coisa só, ser movido para Aplicativos ou sair, e não é um segundo
  Alumia na barra de menus. Movido por cima de um Alumia que está rodando, ele
  faz esse sair antes e toma o lugar dele, e de duas cópias em pastas
  Aplicativos só uma roda. A mudança ainda não foi vista no próprio app, e de
  uma imagem que veio de um download arrastar é o caminho que se conhece
  ([The Mac app](docs/mac-app.md#only-from-applications-and-one-at-a-time)).
- **Os Ajustes do app,** em cinco painéis: os computadores, adicionados,
  editados e removidos numa folha, que diz para que serve adicionar um; quem
  entra na página, e a troca da senha; de onde a página é acessada, com o
  estado do Tailscale neste Mac; a porta, o nome mostrado na página, o medidor
  e o registro do servidor, mostrado no Finder; a aparência e o idioma.
- **A página publicada no Tailscale pelo próprio app,** sem botão: enquanto o
  Alumia está ligado e "Acessível de outros aparelhos" também, e tirada do ar
  enquanto ele está parado. Onde o endereço deste Mac no Tailscale já leva a
  outra coisa, o app diz a quê e não mexe até o dono entregar o endereço.
- **Os avisos do app,** um por vez, cada um com o botão que resolve: o
  Compartilhamento de Tela desligado, a autorização do macOS faltando, o
  serviço parado com o motivo que o próprio servidor dá, o macOS impedindo o
  Alumia de alcançar a rede local, e o FFmpeg faltando.
- **A rede local pedida pelo app:** o próprio app tenta alcançar os
  computadores dos ajustes, e é isso que faz o macOS perguntar, em nome do
  Alumia, se ele pode alcançar os computadores da rede do Mac.
- **O Mac em que você está não é aberto numa tela virtual:** com a página
  aberta no Mac que hospeda o alumia, a linha desse Mac fica no Espelhado e diz
  por quê, já que uma tela virtual apaga as telas em que a página está. De
  outro aparelho que chega pelo Tailscale a linha tem os dois modos, como antes;
  por um túnel SSH, ou por um proxy que não diz de onde veio o pedido, o
  navegador não se distingue de um que está no Mac, e só recebe o Espelhado.
- **O FFmpeg instalado pelo app:** enquanto ele falta o app diz isso nos
  Ajustes, num aviso e no menu, e um clique instala pelo Homebrew, mostrando o
  que o Homebrew diz; num Mac sem o Homebrew, leva a instalá-lo e continua
  sozinho.
- **Desinstalar,** no app: ele diz o que apaga, pergunta, apaga os ajustes, as
  senhas guardadas, o serviço e a publicação no Tailscale que aponta para o
  Alumia, e oferece levar o app para o Lixo. Um app posto no Lixo com o Alumia
  rodando leva os mesmos rastros com ele.
- **Outros Macs com Alumia** na página, depois dos seus computadores, quando o
  servidor é hospedado pelo app de Mac e acha algum na rede do Tailscale: uma
  linha para cada um, pelo nome que aquele Mac dá a si mesmo, que leva a janela
  ao Alumia daquele Mac.
- **Uma sessão encerrada no Mac que hospeda o Alumia diz isso:** encerrada
  pelo menu do app, porque o Alumia foi parado ali, ou porque os ajustes dele
  mudaram, cada caso com a sua frase.
- **O terminal em duas línguas:** o que um comando diz quando falha, o painel
  `alumia tui` e a ajuda da linha de comando saem em português ou em inglês,
  conforme o idioma do terminal (`LC_ALL`, `LC_MESSAGES`, `LANG`; no Windows, o
  idioma do usuário), cada falha com o seu código.
- **Conferências e ferramentas:** a página cobrada pelo design system, testes
  de navegador contra o servidor de teste do próprio repositório, sem
  computador remoto, provas por defeito plantado de que esses testes reprovam
  quando devem, e o produto fotografado ao lado da prancha.
- **Documentos:** o design system, uma prancha navegável do navegador e do
  aplicativo de Mac, os planos e as pesquisas, e estes documentos de entrada em
  duas línguas.

- **Duas telas, cada uma na sua aba** (alfa): um computador com Windows ou um
  Mac no modo Virtual com `virtual_displays = 2`, e um Linux com wlshare e duas
  saídas. A primeira tela fica na página da sessão e a segunda abre, pela folha
  de Telas, em outra aba do mesmo navegador, com uma barra própria que mostra o
  número da tela. Num computador com Windows a primeira tecla da linha escolhe
  onde fica a segunda tela. Uma tela aparece em uma aba por vez, e outra aba
  pergunta antes de assumir. No app de Mac é o interruptor "Duas telas" da
  folha de um computador, num Windows e num Mac, menos num Mac guardado só no
  modo Compatível.
- **Tela indisponível:** enquanto o vídeo de um Mac não chega, ao abrir e
  quando o Mac o reinicia, a página diz isso em vez de mostrar uma imagem vazia
  ou velha. O teclado e o ponteiro ficam segurados até a imagem voltar, e uma
  tecla que estava presa é solta.
- **A rolagem num Mac vai nos dois sentidos** e pela distância rolada, como o
  visualizador da própria Apple manda.
- **Um X preto como ponteiro** onde o computador remoto não entrega a forma do
  ponteiro, em vez de ponteiro nenhum.

### Changed

- **A folha da área de transferência tem duas direções, cada uma com um
  botão.** Do computador remoto: o texto como está, numa caixa que não é
  campo, para que abrir a folha no celular não suba o teclado, e *Copiar para
  este aparelho*. Daqui: *Enviar o que copiei aqui*, um toque que lê a área de
  transferência deste aparelho e manda, e *Escrever…*, que abre o campo só
  quando pedido. O cartão que escondia o texto atrás de um toque, e o botão
  Colar, saíram.
- **Todo campo de texto tem 16 px num aparelho de dedos,** porque o iOS
  amplia a página para focar um campo menor e não volta sozinho.
- **O laboratório diz quando o cursor para numa borda** enquanto a vista não
  pode mais se mover: qual borda, com a altura da janela e o viewport visual do
  navegador, no painel dele e no registro do servidor.
- **O celular recebe a imagem de um Mac na largura em que a mostra.** Nos dois
  modos de um Mac, a imagem chega ao celular no máximo na largura em que ele a
  mostra: o lado menor da tela ao abrir, o lado maior depois de girar, e mais a
  cada pinça que amplia, até os pixels do próprio Mac. O codificador do Mac
  também segura a imagem no que consegue codificar a tempo, pela própria
  medida, e assim um Mac ocupado manda ao celular uma imagem menor em vez de
  atrasada. Um computador de mesa recebe o tamanho da janela, como antes, seja
  qual for a carga do Mac.
- **A folga do som é medida.** A página dá ao som a folga que os pacotes
  mostram precisar, pelo atraso com que chegam, até os 300 ms que já eram o
  teto: um Mac na mesma mesa começa como antes, e um celular cujos pacotes
  chegam em lotes deixa de ouvir um buraco a cada lote.
- **O laboratório.** Sete toques ou cliques na linha "Versão" da folha de
  Informações ligam e desligam o laboratório da página, guardado no navegador.
  Ligado, a linha diz isso, e a página conta ao servidor o que vê — a sessão
  abrindo, cada tamanho, o que o decodificador de vídeo disse, cada imagem
  inteira pedida e pintada, quando sai e volta à vista, a folga do som —, que
  o servidor grava no registro como linhas `lab:`, vinte linhas por mensagem
  e quatro mensagens por segundo no máximo. Ligado, a folha de Informações
  também tem uma aba Laboratório: um painel de instrumentos dos mesmos eventos,
  o último minuto da imagem como um traço na própria grade do vidro (aceso
  quando a imagem chegou, vermelho onde uma imagem inteira foi pedida, apagado
  onde a página estava fora de vista), o último evento em palavras, e quatro
  medidores com um número grande cada (a largura mostrada, a folga do som,
  quantas vezes escondida, conectada há quanto) com as suas contagens, mudando
  na hora em que a página os vê, com Copiar relatório.
- **Um Windows que entrega uma tela das duas pedidas diz isso.** A página da
  sessão mostrava uma tela e nada dizia da outra; agora diz, ao lado da imagem,
  que a segunda tela não está disponível naquele computador.
- **A aba da segunda tela tem o teclado na tela no celular e no tablet,** na
  barra dela, onde antes dava para apontar e não para digitar.
- **A aba da segunda tela para quando a página da sessão some.** Fechada,
  recarregando ou com a conexão caída: a aba diz que a página da sessão foi
  fechada, solta o que estava preso e não manda nada ao computador remoto, onde
  antes continuava mandando teclas e cliques por até um minuto sem dizer nada.
  Ela volta sozinha quando a página volta.
- **Um erro do motor diz a própria causa.** Uma sessão que terminava, ou um
  computador que não conectava, só com a frase geral e o texto em inglês do
  motor em Detalhes passa a dizer o que aconteceu, nas duas línguas: uma conexão
  que caiu, uma resposta que o Alumia não entende, uma troca de login que
  falhou, uma tela grande demais para guardar, uma imagem que não pôde ser lida,
  entre vinte e nove causas novas. Um codificador de vídeo que falha diz isso
  quando a sessão termina, e uma sessão que o servidor não conseguiu iniciar
  também, onde a página não era avisada de nada.
- **O decodificador HEVC opcional por software, para um navegador, é o
  hevc-wasm 0.0.3.** Um servidor que tenha o arquivo 0.0.1 o recusa na partida
  e diz o comando que baixa o novo.
- **A versão é a do próprio alumia, hoje 0.1.1,** e não mais o número do projeto de
  onde ele veio.
- **Uma sessão muda aqui avisa que está muda.** O botão Silenciar da barra
  mostra o alto-falante riscado enquanto está apertado, e a alça da barra
  fechada mostra a mesma marca. Uma sessão com som começa tocando em todo
  aparelho, celular e tablet incluídos: o toque em Abrir é o que liga o som. No
  Safari, e em qualquer navegador de um iPhone ou de um iPad, a página
  recarregada volta muda, porque esse navegador só começa um som num toque, e
  o Silenciar é esse toque.
- **As telas de um Mac numa imagem só se chamam Tela combinada;** Todas as
  telas agora quer dizer cada tela na sua aba.
- **O vídeo de um Mac se sustenta melhor:** o servidor toma o vídeo do Mac como
  a única imagem de uma sessão Virtual ou Espelhada, pede de novo o pedaço que
  se perdeu em vez de uma imagem inteira, e diz a causa certa quando o Mac não
  prepara o envio ou quando outro visualizador já está com o Mac.
- **Um arrasto que sai da imagem continua,** por cima da barra ou além da borda
  da janela.
- **Um celular ou um tablet abre na densidade do próprio aparelho um computador
  que mantém o tamanho,** no Windows e no Linux com wlshare: mais nítido, onde
  antes abria em 1x.
- **O motivo de uma conexão fechada chega à página atrás de um proxy ou de um
  túnel,** onde antes aparecia como conexão que caiu.
- **Um servidor VNC comum é lido só com ZRLE e Raw.**
- **Um Mac que não aceita a mensagem de rolagem do Compartilhamento de Tela não é
  aberto como Mac,** e a página diz isso; antes ele era rolado só pela roda. Um
  Mac assim ainda pode ser configurado como um servidor VNC comum.
- **O produto se chama alumia.** O binário, o arquivo de configuração
  (`alumia.toml`), as variáveis de ambiente (`ALUMIA_*`) e os caminhos de
  instalação levam o nome.
- **Os dois modos de fluxo de um Mac se chamam Virtual e Espelhado** onde a
  página os nomeia, sem o selo "não oficial".
- **Com algo aberto por cima da tela remota, o computador remoto não recebe
  entrada:** o menu, a área de transferência, a lista de telas, a folha de
  informações, as preferências, o medidor e um diálogo. A barra aberta sozinha
  deixa a tela viva.
- **O teclado na tela segue o aparelho, e não a largura da janela:** um
  celular deitado continua com o teclado de celular.
- **Encerrar e Cancelar apagam a tela** antes de a lista voltar.
- **O README** é para quem usa o alumia; compilar, conferir e empacotar foram
  para o `README_DEV.md`, e a referência dos servidores para o
  `docs/servers.md`.
- **Uma sessão Espelhada lista as telas do Mac.** Com mais de uma tela ligada, a
  lista de telas mostra todas, com a marca na principal, que é a que o fluxo do
  Mac carrega; as outras aparecem como indisponíveis, com o porquê e o caminho
  para uma delas, o modo Virtual do Mac. Medido no macOS 27: o Mac aceita o
  pedido de outra tela e continua mandando a principal, por isso o pedido não é
  enviado.
- **A espera pela imagem é a tela que acende.** Enquanto a imagem de um Mac não
  chega, ao abrir, depois de trocar de tela ou de o fluxo dele recomeçar, e
  enquanto uma tela muda de tamanho, a página não mostra mais uma caixa com o
  título "Tela indisponível": mostra a tela que acende, acesa pela metade e
  respirando devagar, com o nome da sessão e uma linha só na placa da abertura,
  "Aguardando a tela remota…" ou "Redimensionando…". Não há barra de progresso,
  porque a espera não tem prazo conhecido. Quando a página desiste de pedir a
  imagem, a luz para e a placa diz isso, com Recarregar. Quando a imagem chega,
  a grade acesa se dissolve sobre ela, uma vez. Com "reduzir movimento" ligado,
  a luz fica parada.

### Removed

- **A chave de configuração `audio_adaptive_min`.** A taxa mais baixa até onde
  o som acompanha a conexão é a do próprio codificador; um arquivo que ainda
  tenha a chave é recusado na partida, com a chave dita.
- **Da lista de computadores:** repassar o vídeo do Mac, repassar o desenho do
  Windows, e o som sem perdas. O servidor continua fazendo os três, pedidos
  pelo endereço da página (`?passthrough=1`, `?sound=lossless`), e repassa o
  vídeo do Mac sozinho onde não tem decodificador.
- **A tecla de tamanho de um Mac no modo Espelhado:** a imagem dele é sempre
  ajustada a quem vê, e o tamanho das próprias telas deixou de ser uma escolha.
- **O menu flutuante** e as opções embaixo de cada computador, trocados pela
  barra da sessão e pelas teclas do monitor.

### Fixed

- O alerta do app de Mac que pergunta antes de desinstalar lista o que apaga um
  item por linha, cada um com o seu marcador e recuo de continuação, numa vista
  larga o bastante para os itens, com o que fica depois deles. Na 0.1.2 um item
  que não cabia continuava embaixo do marcador, sem recuo.
- Uma sessão no celular volta do fundo com a imagem. A página avisa o servidor
  quando está fora de vista, e de novo quando a sessão abre, para que uma
  conexão que caiu escondida também volte à vista; o servidor não manda nada
  até ela voltar, e então uma imagem inteira; a página descarta o decodificador
  de vídeo que tinha, que o iPhone invalida no fundo, e monta outro sobre essa
  imagem. Antes, a imagem congelava com um erro do decodificador (AL-4602) ao
  voltar para a aba.
- Uma imagem inteira pedida de novo dentro de 300 ms da última é mandada uma
  vez: um celular atrasado em relação à tela pedia oito vezes numa sessão e
  recebia oito imagens inteiras.
- Nenhuma bolha "Colar" no iPhone, no iPad, no Safari ou no Firefox ao abrir a
  sessão ou ao focar a página: a página lê a área de transferência ao focar só
  onde o navegador concede isso uma vez, como permissão (Chrome e Edge, que
  ficam como estavam), e não onde ele pergunta à pessoa a cada leitura. A folha
  da área de transferência tem *Enviar o que copiei aqui* em todo navegador,
  que lê a área de transferência deste aparelho dentro do toque e manda: ali o
  navegador pergunta uma vez, pela leitura que a pessoa pediu.
- A tela que acende cresce do monitor do computador assim que ele é pressionado,
  sem esperar um quadro do relógio da interface, que um navegador ocupado podia
  segurar.
- A tela embutida de um MacBook fechado volta a ficar apagada depois de uma
  sessão no modo Virtual, e fica apagada enquanto durar o processo do servidor.
  Hospedado pelo app de Mac, o servidor aceita ajustes novos sem encerrar o
  processo, então mudar um ajuste não acende a tela, e um servidor que sobe de
  novo depois de uma atualização volta a segurá-la de onde o anterior parou.
- A primeira imagem de um Mac chega mais cedo: o decodificador é aquecido
  antes dela.
- Uma sessão no modo Espelhado pega as portas de uma oferta na resposta da
  própria oferta.
- O modo Espelhado abre num Mac com mais de uma tela, como um MacBook de tampa
  aberta ao lado de um monitor externo: antes terminava em dez segundos,
  culpando um firewall. Ele mostra a tela principal do Mac, e o ponteiro cai
  nela.
- O vídeo de um Mac que não começa diz o que chegou no lugar: imagens de outra
  tela, pacotes sem imagem, ou nada, e só este último caso fala em firewall.
- As mensagens de erro saem inteiras no idioma da página. O motivo que o
  servidor, o navegador ou o computador remoto dá não entra mais no meio da
  frase, em inglês: cada causa conhecida tem a sua frase e o seu código (a
  senha recusada, o computador que não responde, o que o Windows diz ao
  encerrar uma sessão, cada caso do vídeo e do som de um Mac), e o texto
  original fica em Detalhes.
- A folha de informações não se mexe mais ao abrir "Detalhes", e as tabelas
  dela têm linhas de uma altura só.
- O fundo de vidro da página acompanha o tema na hora, em qualquer aparelho.
  Ele ficava no tema anterior até o ponteiro se mexer, e num celular para
  sempre.
- Um celular no modo Espelhado de um Mac recebe a imagem com a largura do lado
  maior da própria tela, nos pixels dele. Ele recebia uma tela de 5120×2880
  com 3840×2160, ficava dezenas de segundos atrasado e perdia a conexão.
- A imagem perdida quando o decodificador de vídeo do navegador falha volta. A
  página pede uma imagem inteira ao servidor a cada dois segundos até uma ser
  pintada, por até trinta segundos, e de novo quando a página volta a
  aparecer; antes pedia uma vez só. Passado esse tempo ela diz que a imagem
  não vai voltar, com o botão Recarregar, e o aviso guarda em Detalhes o que o
  navegador disse do decodificador.
- Um computador não fica mais em "Conectando…" para sempre depois de o
  servidor dispensar sozinha a conexão da imagem: a página refaz as duas
  conexões por conta própria. Um tamanho que a página não conseguiu aplicar
  também não a prende mais ali, e fica dito no console do navegador.
- O Edge não desenha mais um segundo olho no campo de senha.

## 0.0.325 e anteriores

A história antes deste ponto é a do remotex: veja
[o repositório dele](https://github.com/andrewtheguy/remotex).
