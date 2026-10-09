# Mapa da documentação

Esta é a cópia pública do repositório, uma foto por versão: os planos, as pesquisas, as comparações, as pranchas ficam no repositório de trabalho, `aleonnet/alumia-app`, e não estão aqui.

O primeiro arquivo a abrir ao retomar trabalho. Alumia nasceu do
[remotex](https://github.com/andrewtheguy/remotex), de Andrew Chen (licença MIT). Os documentos
técnicos do motor vêm de lá, em inglês. Os planos e as pesquisas são desta casa, em português.

## Por onde entrar

Três documentos de entrada na raiz do repositório, cada um em inglês e em português. O
`tools/check-docs.py` cobra que as duas línguas de cada um tenham as mesmas seções, os mesmos
blocos de comando e os mesmos links.

- [README.md](../README.md) e [README.pt-BR.md](../README.pt-BR.md): para quem usa. O que é,
  a sessão, o celular, o app de Mac, o que dá para abrir, os cinco comandos e a documentação,
  com as imagens do produto de `readme/`. A configuração, chegar por outro aparelho e a
  segurança estão em [install.md](install.md).
- [README_DEV.md](../README_DEV.md) e [README_DEV.pt-BR.md](../README_DEV.pt-BR.md): para quem
  desenvolve. Compilar, conferir, testar, empacotar e trazer o trabalho do original.
- [CHANGELOG.md](../CHANGELOG.md) e [CHANGELOG.pt-BR.md](../CHANGELOG.pt-BR.md): o que mudou
  que alguém usando notaria, desde que o Alumia saiu do remotex.

## Design (`design/`)

As regras e os valores da interface. A prancha e o produto leem os mesmos valores.

- [2026-10-03-0003-design-system.md](design/2026-10-03-0003-design-system.md): o design
  system: princípios, cor, tipo, movimento, voz, glifos, componentes, diálogos e a tabela "da
  prancha ao código". Aceito.
- [2026-10-04-1314-adendo-lista-e-tubo.md](design/2026-10-04-1314-adendo-lista-e-tubo.md): o
  adendo que vale onde difere do design system: a lista de computadores, os quatro glifos
  próprios, o acender e o apagar como tela de tubo, e as três opções que saíram da interface.
  Aceito.
- [2026-10-05-0030-adendo-app-de-mac.md](design/2026-10-05-0030-adendo-app-de-mac.md): o
  adendo do app de Mac como foi construído: o vidro, medido (o que o sistema faz sozinho e o
  que o app pede pelo nome), o ícone da barra de menus, o Alumia parado, o FFmpeg, as duas
  folhas dos Ajustes, o que mudou em remover, a janela da imagem de disco, e os outros Macs na
  lista da página. Aceito.
- [2026-10-06-2030-adendo-janelas-luz-e-disco.md](design/2026-10-06-2030-adendo-janelas-luz-e-disco.md):
  o adendo que vale onde difere do de cima, depois dos dois consertos de 2026-10-06: as
  janelas que mostram o que está atrás, as abas dos Ajustes numa cápsula de vidro com uma bolha
  que desliza, a luz do menu que pede para ser vista, a pergunta de quem abre o app fora de
  Aplicativos, e o ícone da imagem de disco. Diz as duas coisas do adendo anterior que deixaram
  de valer. Aceito.
- [2026-10-07-2100-adendo-sinal-de-mudo.md](design/2026-10-07-2100-adendo-sinal-de-mudo.md):
  o adendo do sinal de que a sessão está muda: o alto-falante riscado no botão "Silenciar"
  enquanto apertado e na alça da barra fechada, e por que existe. Aceito.
- [2026-10-07-1254-adendo-app-duas-telas.md](design/2026-10-07-1254-adendo-app-duas-telas.md):
  o adendo da folha do computador no app de Mac, que vale onde difere do adendo do app: a
  linha "Duas telas", onde ela aparece, o que o interruptor faz e o que o app grava. Aceito.
- [2026-10-07-0926-adendo-teclado-no-celular.md](design/2026-10-07-0926-adendo-teclado-no-celular.md):
  o adendo do teclado na tela no celular, que vale onde difere do design system: as sete
  fileiras das duas telas, a faixa sempre presente com as setas, os símbolos com Shift como
  teclas próprias, e a chave "Sticky". Diz as três frases do design system que deixaram de
  valer. Aceito.
- [2026-10-10-0030-adendo-area-de-transferencia-e-campos.md](design/2026-10-10-0030-adendo-area-de-transferencia-e-campos.md):
  a folha da área de transferência em duas direções, os campos de 16 px onde o apontador é
  um dedo, o alerta de desinstalar em prosa, e os ícones de instalar como a marca. Superado
  pelo de baixo (o alerta em prosa foi reprovado na tela), e mantido como estava.
- [2026-10-10-0900-adendo-alerta-de-desinstalar.md](design/2026-10-10-0900-adendo-alerta-de-desinstalar.md):
  o adendo que vale onde difere do design system: o mesmo de cima, com a seção do alerta de
  desinstalar refeita: uma lista com marcadores e recuo de continuação numa vista própria do
  alerta, mais larga. Aceito.
- [2026-10-09-1400-adendo-fontes-estruturadas.md](design/2026-10-09-1400-adendo-fontes-estruturadas.md):
  o adendo que vale sobre o design system onde ele fala da prancha como fonte: os textos da
  interface são `words.json` e os glifos são `glyphs/`; a prancha é documento e consumidora,
  conferida contra os dois, e uma árvore sem ela compila e confere igual. Aceito.
- [alumia.tokens.json](design/alumia.tokens.json): as cores, a fonte, os espaços e os tempos,
  no formato DTCG 2025.10. A fonte única dos valores.
- [words.json](design/words.json): os textos da interface, nas duas línguas, por chave, na
  ordem em que a prancha os tem. A fonte dos dois dicionários da página e do dicionário do app
  de Mac; a prancha carrega uma cópia, conferida.
- [glyphs/](design/glyphs/check.svg): um SVG por glifo da página, na grade do Lucide, 34 do
  Lucide e 8 do produto. A fonte de `frontend/src/Glyph.tsx`; as três folhas que os desenham
  carregam cópias, conferidas.
- [errors.json](design/errors.json): cada lugar onde o produto mostra uma mensagem, com o
  código e o texto em pt-BR e en-US. Os lugares da página e do servidor vão numa cópia que a
  página e a prancha carregam; os do terminal e os do app de Mac ficam só aqui.
- [terminal-words.json](design/terminal-words.json): o que o terminal diz e não é erro (a
  ajuda da linha de comando, o painel `alumia tui`), nas duas línguas, e as frases que ficam em
  inglês, cada uma com o motivo.
- [app-words.json](design/app-words.json): os textos do app de Mac que `words.json` não tem,
  os de `words.json` que o app não usa, e os que ele divide com a página, cada um com o motivo.
- [fonts/](design/fonts/OFL.txt): a Instrument Sans e a licença dela (OFL).
- [icons/lucide-ISC.txt](design/icons/lucide-ISC.txt): a licença dos glifos da página.

## As imagens do README (`readme/`)

Capturas do produto para o README, escritas por `bash tools/site/build.sh` e mantidas no
repositório: a lista nos dois temas e idiomas, a barra da sessão, a tela que acende, o
celular (entrar, a lista, a tela que acende), as telas do app de Mac montadas do código dele
nos dois temas, e o cabeçalho `alumia-escuro.svg` e `alumia-claro.svg`, a marca sobre o
vidro, acesa uma vez. Nenhuma vem da prancha: `tools/site/check.py` cobra.

## A página pública (`../site/`)

`site/index.html` é a página de apresentação do GitHub Pages, montada do produto por
`tools/site/` e mantida no repositório, com as quatro capturas de `site/real/`. O fluxo
`.github/workflows/pages.yml` publica a pasta como está, no repositório público, a cada envio
à linha principal dele que toque `site/`: a página é <https://aleonnet.github.io/alumia/>. Ver
[README_DEV.pt-BR.md](../README_DEV.pt-BR.md).

## O motor (inglês, vindo do original)

- [servers.md](servers.md): o que o Alumia abre e como: os dois protocolos, os níveis dos
  servidores, os modos do Mac, a densidade de tela, o som, a câmera e o microfone. Saiu do
  README, por inteiro.
- [local-instances.md](local-instances.md): o painel de várias instâncias (`alumia tui`).
- [mac-app.md](mac-app.md): o aplicativo de Mac, que é desta casa e está em inglês como o resto
  da referência: o que vai no pacote, o serviço, onde cada coisa fica guardada, como o app e o
  servidor conversam, o processo que não termina, o Tailscale, os outros Macs, o FFmpeg, como
  montar e notarizar, e a cópia de teste.
- [architecture.md](architecture.md): a arquitetura e as regras de projeto; ler a seção de uma
  área antes de mexer nela.
- [apple-vnc-889.md](apple-vnc-889.md): o protocolo do Compartilhamento de Tela da Apple, medido.
- [high-performance-decoder.md](high-performance-decoder.md): o decodificador do modo de alto
  desempenho.
- [standard-rfb-hidpi.md](standard-rfb-hidpi.md): densidade de tela no RFB padrão.
- [rdp-client.md](rdp-client.md) e [rdp-spec-audit.md](rdp-spec-audit.md): o cliente RDP e a
  auditoria dele contra as especificações.
- [wlshare-audio.md](wlshare-audio.md), [wlshare-camera.md](wlshare-camera.md),
  [wlshare-density.md](wlshare-density.md), [wlshare-microphone.md](wlshare-microphone.md),
  [wlshare-outputs.md](wlshare-outputs.md): as extensões do wlshare, o servidor de Linux.
- [install.md](install.md), [known-issues.md](known-issues.md), [roadmap.md](roadmap.md).
- [release.md](release.md): como uma versão é publicada, em inglês: os atos de uma vez só
  (renomear o privado para `alumia-app`, criar o público, a chave de publicação, as regras
  que só a deixam escrever, o Pages, o pacote de contêiner) e os de cada versão (o registro
  de mudanças, a imagem de disco, o ensaio da publicação, o ensaio dos pacotes, a etiqueta,
  `tools/publish-public.sh`, o fluxo de release no público), cada passo com o comando e o que
  a saída diz, e cada recusa do script com o porquê.

## Ferramentas (`../tools/`)

- `tools/rename-product.sh`: troca o nome do produto em todo o repositório.
- `tools/sync-original.sh`: traz o trabalho novo do original, já renomeado. Deixa a junção sem
  commit; os portões rodam antes do commit.
- `tools/publish-public.sh`: a única coisa que escreve no repositório público
  `aleonnet/alumia`. `publish <versão>` exporta a etiqueta `v<versão>` da linha principal já
  enviada, tira o que `tools/public-paths.txt` lista, varre segredos e endereços (com as
  exceções de `tools/public-allowed.txt`, cada uma com motivo), roda as conferências do
  repositório na exportação, grava a foto como um commit, envia com a etiqueta e cria a
  release com a imagem de disco; `--check` diz se o público é a foto da última versão;
  `--export` faz a exportação sozinha, para o portão e para as plantas. O público é o fork do
  projeto original, e a foto entra por cima da linha principal dele. Envia com a chave de
  publicação e com nenhuma outra identidade. Recusa cada condição errada com uma frase
  ([release.md](release.md)).
- `tools/rehearse-publish.sh`: ensaia a publicação de uma versão de ponta a ponta, sem nada
  chegar ao GitHub: o roteiro de cima, como está no disco, publica `HEAD` em dois repositórios
  de mentira sob `tmp/rehearsal/`, com um `gh` que só anota o que lhe pedem e a imagem de
  disco de verdade. Quinze passos, cada um com o código de saída e a frase esperada: as
  recusas, a primeira publicação e a retomada dela, uma segunda versão por cima, e a primeira
  pedida de novo depois. É portão.
- `tools/contrast.py`: mede o contraste dos pares de cor do design system (WCAG 2.2) e a
  distância entre as duas cores do gráfico de vazão sob daltonismo.
- `tools/check-design.py`: confere que os tokens, o catálogo de erros e a prancha continuam
  de acordo entre si e com o código do produto.
- `tools/check-docs.py`: confere os documentos de entrada: as duas línguas de cada um com as
  mesmas seções, os mesmos blocos de comando e os mesmos links, e nada do README antigo
  perdido.
- `tests/mockup/`: o teste da prancha num navegador sem janela (`bun run test`). É separado
  de `tests/playwright/`, que testa o produto.
- `tools/mockup_sources.py`: a ponte entre a prancha e as fontes. `--extract` escreve
  `design/words.json` e `design/glyphs/` a partir das três folhas (o passo que promove o que
  foi aprovado na prancha); `--refresh` devolve `words.json` aos dois dicionários da prancha;
  `--check` diz cada texto e cada glifo em que a prancha derivou das fontes. Sem a prancha na
  árvore, diz isso e passa.
- `tools/product-words.py`: escreve os dois dicionários do produto (`frontend/src/words/`) a
  partir de `design/words.json` e de `design/product-words.json`, que lista os textos que o
  produto tem e a fonte não, os da fonte que o produto não usa, e os nomes que o
  servidor manda em inglês, cada um com o motivo. Com `--check`, reprova um dicionário que não
  é o que a ferramenta escreve.
- `tools/app-words.py`: escreve o dicionário do app de Mac
  (`macos/Alumia/Sources/AlumiaCore/Generated/Words.generated.swift`) a partir dos textos
  `mac.` de `design/words.json`, de `design/app-words.json` e dos lugares do app no catálogo,
  com as cores da marca tiradas dos tokens. Com `--check`, reprova texto escrito direto no
  Swift, chave ou código sem uso, e o que falta numa das línguas.
- `packaging/build-mac-app.sh` e `packaging/build-mac-dmg.sh`: montam o app de Mac e a imagem
  de disco assinada e notarizada. Com `--test`, o primeiro monta uma cópia de teste que não
  toca no Alumia instalado e sabe se conferir sozinha (`--smoke`, `--smoke-trash`).
- `tools/product-glyphs.py`: escreve os glifos do produto (`frontend/src/Glyph.tsx`) a partir
  de `design/glyphs/`. Com `--check`, reprova um `Glyph.tsx` que não desenha o que os arquivos
  dizem, nome a nome, sem rodar formatador.
- `tools/run-page-tests.sh`: roda, com um comando, os testes do navegador que não precisam de
  computador remoto, contra o servidor de teste do próprio repositório
  (`tools/page-harness.sh` sobe e derruba esse servidor, um por arquivo de teste).
- `tools/compare-screens.sh`: tira as fotos do produto e da prancha, cena por cena, e monta a
  página de `comparisons/`. Uma rodada por entrega; nenhum teste depende de foto. Numa árvore
  sem as pranchas, recusa numa frase.
- `tools/refute-page.py`: prova que os testes do produto reprovam quando devem. Planta um
  defeito por vez no código da página, do servidor ou do aplicativo de Mac, exige o texto
  exato da falha e devolve o arquivo como estava, conferido pela impressão digital. Não é um
  portão, e não roda ao lado de outra compilação: o defeito fica na árvore enquanto o teste
  dele roda.
- `tools/product-icons.mjs`: escreve o manifesto de app e os ícones de instalar
  (`frontend/public/`) a partir da marca e dos tokens.
- `tools/site/`: monta a página pública e as imagens do README do produto (`build.sh`;
  `site.toml` com os três computadores de exemplo; `harvest.mjs` colhe a página do servidor;
  `capture.mjs` fotografa; `build.py` monta `site/index.html` de `template.html`,
  `words.json`, da colheita em `dom/` e do código do produto; `check.py` cobra as palavras
  do produto e só imagens do produto).
- `tools/refute-mockup.py`: prova que essas conferências reprovam quando devem. Planta um
  defeito por vez, exige o texto exato da falha e devolve o arquivo como estava, conferido
  pela impressão digital. Leva vários minutos e não é um portão: roda antes de um commit que
  mexe na prancha, nos tokens, no catálogo ou nas conferências.

Os links desta árvore e dos documentos de entrada são conferidos com
`lychee --offline --root-dir . docs/ README.md README.pt-BR.md README_DEV.md README_DEV.pt-BR.md CHANGELOG.md CHANGELOG.pt-BR.md`.
