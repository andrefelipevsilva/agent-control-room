# Agent Control Room

**Uma tela só para ver seus agentes do Claude Code ao vivo.** O escritório em pixel art do [Habblaud](https://github.com/marmottajr/habblaud) e o grafo do [Agent Flow](https://github.com/patoles/agent-flow), lado a lado, acompanhando as mesmas sessões ao mesmo tempo.

[Read in English](README.md)

![Agent Control Room: Habblaud à esquerda, Agent Flow à direita](docs/screenshot.png)

- O **Habblaud** mostra *quem* está trabalhando: cada sessão é um personagem andando num escritório, com um feed de atividade.
- O **Agent Flow** mostra *como* eles trabalham: cada chamada de ferramenta, subagente e retorno num grafo ao vivo.
- O **Agent Control Room** liga os dois, coloca os dois numa tela só e traz layouts feitos para assistir e para gravar vídeo.

É um projeto independente. Ele não inclui nem altera o código de nenhuma das duas ferramentas: roda as suas instalações locais das duas e mostra as duas juntas.

## O que ele faz

- **Um comando** liga tudo: o Docker Desktop e o container do Habblaud quando estão desligados, o Agent Flow quando não está rodando, e o navegador.
- **Três layouts**: lado a lado, empilhado (um em cima do outro, feito para vídeo vertical 9:16) e flutuante (um painel sobre o outro, que você arrasta e redimensiona).
- **Trocar** os dois de lugar e **arrastar o divisor** (duplo clique divide ao meio). Os painéis nunca recarregam quando o layout muda.
- **Modo gravação** esconde a barra e o rodapé. Passe o mouse no topo, aperte `G` ou `Esc` para a barra voltar.
- **Luzes de status** dos dois serviços; o painel mostra um aviso enquanto o serviço liga e recarrega sozinho quando ele sobe.
- Inglês ou português, conforme o idioma do navegador.

| Tecla | Ação |
|---|---|
| `1` `2` `3` | lado a lado / empilhado / flutuante |
| `T` | trocar os painéis |
| `G` | modo gravação (`Esc` sai) |

Os atalhos valem com o foco na sala. Depois de clicar dentro de um painel, clique na barra de cima antes.

## Requisitos

- [Node.js](https://nodejs.org/) 20 ou mais novo
- [Habblaud](https://habblaud.com) instalado. A instalação guiada dele fica em `~/habblaud` e roda no Docker.
- [Claude Code](https://claude.com/claude-code)
- O Agent Flow vem sozinho pelo `npx agent-flow-app`, ou de um build local (veja abaixo).

Testado no Windows 11 com Docker Desktop. macOS e Linux devem funcionar (`npm start`), mas ainda não foram testados.

## Instalar e rodar

```bash
git clone https://github.com/<seu-usuario>/agent-control-room.git
cd agent-control-room
npm start
```

No Windows também dá para clicar duas vezes no `start.cmd`. A sala abre em `http://localhost:4800/control-room/`. Abra uma sessão do Claude Code em outro terminal e veja ela aparecer dos dois lados.

`Ctrl+C` fecha a sala e o Agent Flow que ela abriu. O container do Habblaud continua ligado, como já acontece normalmente.

### Agent Flow de um build local (opcional)

Se existir uma pasta `agent-flow` ao lado desta, com o build em `agent-flow/app/dist/app.js`, a sala usa esse build no lugar do `npx`:

```bash
git clone https://github.com/patoles/agent-flow.git
cd agent-flow && pnpm i && pnpm run build:app
```

## Configuração

| Variável | Padrão | O que faz |
|---|---|---|
| `ACR_PORT` | `4800` | Porta da sala |
| `HABBLAUD_PORT` | `4747` | Porta onde o Habblaud escuta |
| `HABBLAUD_DIR` | `~/habblaud` | Pasta do Habblaud, usada só quando o container dele ainda não existe |
| `AGENT_FLOW_PORT` | `3001` | Porta do Agent Flow |
| `AGENT_FLOW_APP` | `../agent-flow/app/dist/app.js` | Build local do Agent Flow; sem ele, usa `npx agent-flow-app` |
| `AGENT_FLOW_WORKSPACE` | sua pasta pessoal | Pasta que o Agent Flow observa: sessões abertas nela ou nas subpastas aparecem no grafo |
| `AGENT_FLOW_TELEMETRY` | `false` | Telemetria anônima do Agent Flow, desligada a menos que você ligue |

`--no-open` liga a sala sem abrir o navegador.

## Como funciona

```
navegador ── http://localhost:4800 ── Agent Control Room (Node, só 127.0.0.1)
                                       ├── /control-room/  → a página da sala
                                       └── todo o resto    → Habblaud (127.0.0.1:4747)
            iframe ─────────────────── Agent Flow (127.0.0.1:3001)
```

O Habblaud proíbe ser embutido em outras páginas (`X-Frame-Options: DENY`). A sala serve o Habblaud por um proxy pequeno na própria origem e troca esse cabeçalho por `SAMEORIGIN`. Só a página da sala, na mesma origem, consegue embuti-lo; sites de terceiros continuam sem conseguir. O resto segue como o Habblaud manda. As travas de "só pelo próprio computador" dele (terminal, pedidos de permissão, mensagens) continuam passando: o proxy mantém o `Host` original e as requisições continuam na mesma origem. O Habblaud na porta dele (4747) não muda nada.

O Agent Flow não manda restrição de embutir, então a sala embute direto pelo endereço dele.

## O que roda no seu computador

- O **Agent Control Room** escuta só em `127.0.0.1`. Não tem dependências e não manda nada para lugar nenhum.
- O **Agent Flow**, na primeira vez que roda, adiciona hooks ao `~/.claude/settings.json` para o Claude Code mandar os eventos para ele (é a instalação do próprio Agent Flow; veja o README dele). A sala liga ele com a telemetria desligada.
- O **Habblaud** roda no Docker com as pastas do Claude Code montadas como somente leitura (instalação do próprio Habblaud; veja o README dele).

## Créditos

- [Habblaud](https://github.com/marmottajr/habblaud), de Márcio Junior, licença MIT.
- [Agent Flow](https://github.com/patoles/agent-flow), de Simon Patole, licença Apache 2.0. "Agent Flow" é uma marca de Simon Patole.

O Agent Control Room não tem vínculo com nenhum dos dois projetos nem é endossado por eles. O crédito do escritório e do grafo é todo dos autores; este projeto só junta os dois.

## Licença

[MIT](LICENSE), para o código deste repositório.
