# Desenvolver o alumia

[English](README_DEV.md) · Português

Para quem mexe no código. Para rodar o alumia e usar, veja o
[README](README.pt-BR.md). As regras que mudam como o trabalho é feito aqui
estão no [`AGENTS.md`](AGENTS.md), e as regras de projeto em
[Constraints](docs/architecture.md#constraints): leia a seção de uma área antes
de mexer no que ela cobre.

## Compilar e rodar

Você precisa de [Rust](https://rustup.rs), pelo `rustup`, e de
[Bun](https://bun.sh). O `wasm-pack` vem com o `bun install`, e o `rustup`
instala a versão que os módulos WebAssembly fixam na primeira vez em que são
compilados.

Instale as dependências da página uma vez, e depois use o Cargo. O `cargo run`
refaz a página quando o código dela muda e compila o resultado dentro do
binário do servidor.

```sh
bun install --cwd frontend
cp alumia.example.toml alumia.toml
cargo run -- gen-passwd admin
# Paste the generated credential into alumia.toml, then:
cargo run -- serve -c alumia.toml
```

Abra <http://localhost:52380>. Use `RUST_LOG=info` ou `RUST_LOG=debug` para os
registros do servidor, e `cargo build` para compilar sem ligar o servidor.

O que a página de uma sessão vê chega a esse registro também quando o
laboratório dela está ligado: sete toques ou cliques na linha "Versão" da folha
de Informações ligam e desligam, a linha diz "Laboratório ligado" enquanto está,
e a escolha fica guardada no navegador (`localStorage`, `alumia.lab`). A página
então diz em mensagens `lab` o que viu — a sessão abrindo, cada `resize`, o que
o decodificador de vídeo disse, cada imagem inteira pedida e assentada, se está
à vista, a largura em que mostra a imagem, a folga do som a cada dez segundos, e
o cursor parado numa borda do que está na tela enquanto a vista não pode mais
se mover, com a altura da janela e o viewport visual do navegador — e o
servidor grava cada linha como `lab: …` em `info`, limitado a quatro
mensagens por segundo, vinte linhas por mensagem e 240 caracteres por linha
(`src/ws.rs`, `frontend/src/lab.ts`). Ligado, a folha de Informações também tem
uma aba Laboratório: um painel vivo dos mesmos eventos, contados por tipo na
hora em que a página os vê (a imagem, o som, a vista da aba, a conexão), com
Copiar relatório. É como se lê uma sessão num celular, que
não tem console.

Um servidor para alguém experimentar é compilado com `cargo build --profile qa`
em `target/qa`: otimizado como uma versão de publicação, sem a otimização na
ligação, de modo que uma mudança recompila em segundos e não em minutos. Uma
compilação de depuração é lenta demais para se julgar uma sessão por ela.

```sh
cargo build --profile qa
RUST_LOG=info ./target/qa/alumia serve -c alumia.toml
```

A página compilada vai dentro do binário (`src/assets.rs`), então
`target/release/alumia` roda sozinho, sem `frontend/dist` ao lado. O `build.rs`
roda `bun run build` no diretório privado do Cargo antes de compilar e reprova a
compilação se o `index.html` não estiver lá depois. Não há servidor de
desenvolvimento: só o servidor do alumia serve a página. Quem publica pode
indicar uma página já compilada antes, que não depende da plataforma:

```sh
bun run --cwd frontend build
ALUMIA_PREBUILT_FRONTEND=frontend/dist cargo build --release
```

## Onde fica cada coisa

| Caminho | Conteúdo |
|---|---|
| `src/` | o servidor, a gestão das sessões e os motores de RDP e VNC |
| `frontend/` | a página, em React |
| `frontend/src/design/`, `frontend/src/words/` | os tokens e os dois dicionários que a página lê, escritos por ferramentas |
| `macos/Alumia/` | o aplicativo de Mac, um pacote Swift: o `AlumiaCore` decide, o `Alumia` são as telas |
| `tests/` | testes de ponta a ponta dos protocolos e dos motores |
| `tests/playwright/` | a página num navegador |
| `tests/mockup/` | o teste da própria prancha |
| `tools/` | conferências, geradores e os roteiros do servidor de teste |
| `packaging/` | roteiros de publicação, de instalação e de contêiner |
| `docs/` | referência, design, pranchas, planos e pesquisas |

## Conferências

Depois de uma mudança em Rust, e depois de uma na página:

```sh
cargo clippy --all-targets -- -D warnings
cargo test --lib

cd frontend
bun run check
cd ..
```

Depois de uma mudança no aplicativo de Mac:

```sh
cd macos/Alumia
swift build -c release --arch arm64 -Xswiftc -warnings-as-errors
swift test
cd ../..
```

O conjunto inteiro com que uma entrega é fechada, rodado uma vez na árvore
final:

```sh
cargo clippy --all-targets -- -D warnings
cargo test --lib
cargo test --tests
(cd frontend && bun run check && bun run test)
(cd tests/playwright && bun run typecheck)
uv run --no-project python tools/check-design.py
uv run --no-project python tools/contrast.py
uv run --no-project python tools/refute-mockup.py --anchors
bash tools/run-page-tests.sh
lychee --offline --root-dir . docs/ README.md README.pt-BR.md README_DEV.md README_DEV.pt-BR.md CHANGELOG.md CHANGELOG.pt-BR.md
uv run --no-project python tools/check-docs.py
uv run --no-project python tools/app-words.py --check
(cd macos/Alumia && swift build -c release --arch arm64 -Xswiftc -warnings-as-errors && swift test)
```

Não rode `cargo fmt`. Python local roda sempre pelo `uv`.

## Testes

- **As regras da página**, sem navegador: `bun run test` em `frontend/`.
- **A página num navegador, sem computador remoto:** `bash
  tools/run-page-tests.sh` compila o servidor de teste do próprio repositório
  (`serve_a_test_tone` em `src/server.rs`: o roteador de verdade, com a página
  compilada dentro e um motor encenado) e roda contra ele os testes que não
  precisam de computador remoto, no Chromium, e os do som, da abertura e da sessão
  uma segunda vez no motor da Apple (`bunx playwright install chromium webkit` uma
  vez, em `tests/playwright/`). `-g <título>` roda os testes cujo título
  combina. Veja
  [Stable headless browser tests](tests/playwright/README.md): eles conferem
  decisões, e não pixels.
- **Provas de que os testes reprovam quando devem:**
  `uv run --no-project python tools/refute-page.py` planta um defeito por vez
  no código da página, do servidor ou do aplicativo de Mac e exige que o teste
  indicado reprove com as palavras exatas. Leva minutos e não é portão;
  `--anchors` só confere que cada defeito ainda acha o lugar.
- **VNC contra um contêiner.** O teste de VNC com contêiner usa Docker ou
  Podman e não abre navegador. Fica desligado por padrão; rode-o às claras com:

  ```sh
  cargo test --test vnc_e2e -- --ignored
  ```

  Para uma conexão remota do Podman:

  ```sh
  CONTAINER_CONNECTION=workstation-wsl \
  ALUMIA_TEST_CONTAINER_HOST=<engine-host> \
  cargo test --test vnc_e2e -- --ignored
  ```

  `CONTAINER_CONNECTION` é o nome da conexão de sistema do Podman.
  `ALUMIA_TEST_CONTAINER_HOST` é o endereço IP ou o nome DNS da máquina do
  motor, como a máquina que roda os testes a alcança; um apelido da
  configuração do SSH não é resolvido nas conexões diretas de VNC dos testes.
- **RDP contra uma máquina de verdade.** O RDP não tem contêiner contra o qual
  testar: o cliente RDP do servidor fala NLA com um Windows atual e nada mais,
  então os testes de ponta a ponta dele pegam uma máquina emprestada. Veja
  [`tests/rdp_proto_probe.rs`](tests/rdp_proto_probe.rs) e
  [`tests/rdp_client_probe.rs`](tests/rdp_client_probe.rs).
- **Um Mac ou um Windows de verdade num navegador:** os testes `batch-envelope`,
  `clipboard`, `oversized-clipboard`, `display-drag`, `egfx-passthrough`,
  `egfx-two-displays`, `software-hevc` e `video-stream`, em `tests/playwright/`,
  precisam de um, e o servidor de teste não os roda.
- `tests/ws_probe.py` mostra as mensagens de controle que um navegador vê.
- **O servidor que um aplicativo de Mac hospeda:**
  `cargo test --test app_mode_e2e` roda o binário de verdade como
  `serve --app` numa pasta do próprio teste, num Mac. Com
  `ALUMIA_TEST_BINARY=<pacote>/Contents/Helpers/alumia`, roda os mesmos casos
  contra o binário de dentro de um pacote.
- **O aplicativo de Mac:** `swift test` em `macos/Alumia` cobre o que o app
  decide, sem tela. `packaging/build-mac-app.sh --test --smoke` monta uma cópia
  que não toca num Alumia instalado e a faz conferir o próprio serviço sozinha.
  Veja [The Mac app](docs/mac-app.md#a-copy-made-for-testing).

## A interface: design system, prancha e textos

As cores, os tamanhos e os tempos da página vêm de um arquivo de tokens, os
textos de dois dicionários, e as mensagens de um catálogo. Nada disso é escrito
à mão na página, nem no terminal, nem no aplicativo de Mac.

- [`docs/design/`](docs/design/2026-10-03-0003-design-system.md): o design
  system, os adendos dele, os tokens (`alumia.tokens.json`), os textos da
  interface nas duas línguas (`words.json`), os glifos (`glyphs/`, um SVG
  cada), o catálogo de mensagens (`errors.json`) e os textos que o produto tem
  e a fonte não tem (`product-words.json`).
- `docs/mockups/`: a prancha, e o desenho da lista de computadores. É um
  documento, onde um texto é lido e aprovado e um glifo é desenhado pela
  primeira vez, e uma consumidora das fontes: `tools/mockup_sources.py
  --extract` promove o que ela carrega para `words.json` e `glyphs/`,
  `--refresh` devolve `words.json` a ela, e `tools/check-design.py` segura as
  cópias dela nas fontes. Uma árvore sem ela compila e confere igual: o
  repositório público, `aleonnet/alumia`, não tem nem ela nem `docs/comparisons/`.
- `tools/product-words.py` e `tools/product-glyphs.py` escrevem
  `frontend/src/words/` e `frontend/src/Glyph.tsx` a partir de `words.json` e
  de `glyphs/`; com `--check`, cada um segura o que escreveu na sua fonte.
- `tools/check-design.py` cobra tudo isso da página: nenhuma cor escrita à
  mão, nenhum texto sem fonte, nenhuma mensagem sem código. Cobra o mesmo do
  terminal: o que um comando diz a uma pessoa vem do catálogo ou de
  `docs/design/terminal-words.json`, em inglês e em português. E cobra os
  motores: toda frase que um deles escreve para um erro nomeia a causa, ou
  está listada no catálogo como guardada, com o porquê.
- `tools/app-words.py` escreve o dicionário do aplicativo de Mac a partir dos
  textos `mac.` de `words.json`, de `docs/design/app-words.json` e do catálogo,
  e com `--check` reprova texto escrito direto no Swift.
- `tools/compare-screens.sh` fotografa o produto ao lado da prancha em
  `docs/comparisons/`. Nenhum teste depende de foto, e numa árvore sem as
  pranchas ela recusa numa frase.
- `tools/product-icons.mjs` escreve o que instalar a página precisa em
  `frontend/public/`: o manifesto de app, e a marca desenhada nos ícones que
  ele nomeia, com o Chromium de `tests/playwright/`.

## A página pública e as imagens do README

A página em `site/` e as imagens de `docs/readme/` são montadas do produto e
ficam no repositório: `bash tools/site/build.sh` compila o servidor, roda-o com
os três computadores de exemplo de `tools/site/site.toml` e o servidor de
teste ao lado, colhe a página que ele serve em `tools/site/dom/` e a fotografa,
monta `site/index.html` de `tools/site/template.html`, `tools/site/words.json`
e do código do produto (os shaders, os glifos, a fonte, os tokens, o dicionário
do app de Mac), e fotografa as telas do app de Mac a partir dessa página.
Precisa do Chromium de `tests/playwright/`. `tools/site/check.py` segura a
página e os dois READMEs no que foi aprovado: as palavras do produto, e só
imagens do produto. O fluxo `.github/workflows/pages.yml` publica `site/` como
está, no repositório público, a cada envio à linha principal dele que toque
`site/`: a página é <https://aleonnet.github.io/alumia/>.

## Documentos

- O mapa de todos os documentos é o [`docs/README.md`](docs/README.md). É o
  primeiro arquivo a abrir ao retomar trabalho.
- Um documento novo se chama `aaaa-mm-dd-hhmm-descricao.md`, com um `status:`
  entre `proposto`, `rejeitado`, `aceito`, `obsoleto` e `superado por
  <arquivo>`. Para revisar, cria-se um arquivo novo e marca-se o antigo como
  superado; nunca se reescreve no lugar.
- Os três documentos de entrada existem em inglês e em português: `README`,
  `README_DEV` e `CHANGELOG`. O `tools/check-docs.py` cobra das duas línguas
  de cada um as mesmas seções, os mesmos blocos de comando e os mesmos links.
- Uma mudança que alguém notaria entra no
  [registro de mudanças](CHANGELOG.pt-BR.md), em *Unreleased*, nas duas
  línguas.

## Empacotar e publicar

```sh
bun install --cwd frontend
cargo build --release
bash packaging/build-tarball.sh
bash packaging/build-native-packages.sh
```

As compilações locais do Cargo refazem a página sozinhas quando o código dela
muda, e o binário a carrega. O construtor dos pacotes nativos consome o tarball,
de modo que todo artefato contém o mesmo binário do servidor. Os artefatos são
sempre compilados com `--release`.

O aplicativo de Mac e a imagem de disco dele são montados à parte, no Mac que
tem a identidade de assinatura:

```sh
bash packaging/build-mac-app.sh
ALUMIA_SIGN_IDENTITY="Developer ID Application: …" ALUMIA_NOTARY_PROFILE=<profile> \
  bash packaging/build-mac-dmg.sh
```

Sem identidade, o primeiro assina só para aquele Mac; o segundo precisa da
identidade e de um perfil de notarização guardado, e falha se a imagem não sair
notarizada. Veja [The Mac app](docs/mac-app.md#building-it).

[Packaging](packaging/README.md) tem as árvores dos pacotes, as regras das
dependências pré-compiladas, o piso de processador x86-64 e o fluxo de
publicação, [Installing](docs/install.md), o que cada pacote instala, e
[Releasing](docs/release.md), como uma versão é publicada: a etiqueta no
`main`, `tools/publish-public.sh`, o repositório público `aleonnet/alumia` e a
release dele, cada passo como um comando com o que a saída diz. Antes de uma
versão ser etiquetada, `tools/rehearse-publish.sh` ensaia a publicação dela de
ponta a ponta sem nada chegar ao GitHub, e o fluxo de release disparado neste
repositório ensaia os pacotes, sem publicar nada.

## Trazer o trabalho do original

O alumia nasceu do [remotex](https://github.com/andrewtheguy/remotex). O remoto
`upstream` é o original, e nada é enviado a ele.

- `tools/sync-original.sh` traz o trabalho novo do original, já renomeado, e
  deixa a junção sem commit: as conferências rodam antes do commit.
- `tools/rename-product.sh` troca o nome do produto em todo o repositório.
- Sem squash nas junções.
