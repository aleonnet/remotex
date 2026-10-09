---
status: aceito
---

# Adendo ao design do app de Mac: duas telas na folha do computador

Adendo de 2026-10-07 ao [adendo do app de Mac](2026-10-05-0030-adendo-app-de-mac.md), que
continua em vigor e não é reescrito. Vale este documento onde os dois diferem. O dono abriu a
folha de editar um computador com a linha nova, na folha
duas telas na folha do computador, e
aprovou em 2026-10-07. A folha é o desenho em vigor da folha do computador, e vale sobre a
mesma folha nas
peças novas do app de Mac, de que
foi feita: o resto das peças é igual nos dois arquivos. O plano que a traz é
em dia com o remotex.

## 1. O que muda na folha do computador

A folha ganha uma linha, a última, depois da senha: "Duas telas", com um interruptor à
direita e uma nota embaixo do nome.

- Num Windows a nota é "A segunda tela abre numa aba própria do navegador."
- Num Mac a nota é "A segunda tela abre numa aba própria do navegador, no modo Virtual."
- Num Linux, num servidor VNC comum e num Mac guardado no modo Compatível a linha não
  aparece: nenhum deles abre com duas telas pedidas pelo Alumia.
- Neste Mac a linha aparece e muda, como o usuário e a senha.

Trocar o tipo para um que não tem a linha desliga o interruptor.

## 2. O que o interruptor faz

Desligado, que é como nasce, o computador abre com uma tela, como sempre abriu. Ligado, ele
abre com duas: a primeira na página da sessão e a segunda numa aba própria do navegador,
aberta pela folha de Telas. As duas nunca ficam juntas na mesma aba.

O que o app grava é a chave `virtual_displays = 2` do computador: na entrada de um Windows, e
na entrada do modo Virtual de um Mac, que é um computador aqui e duas entradas no arquivo. A
entrada do modo Espelhado nunca a leva. Desligado, a chave é tirada.

## 3. O que não muda

A lista dos computadores, o resto da folha e todas as outras peças. A posição da segunda tela
de um Windows continua sendo escolhida na página, na linha do computador.
