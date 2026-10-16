# Desk wireframe

Low-fidelity wireframes for the desk. Names are synthetic. Read with
[README.md](README.md), which defines the states, the data, and the phases.

## 1. Floor (home)

The whole viewport is the floor. The only chrome is two icons at the top right: the
assistant (left) and the menu (right). The menu icon carries a dot when an agent is
waiting for a human.

```
+------------------------------------------------------------------------------------+
| desk                                                          (assistant)  (menu)* |
|                                                                                    |
|  ACME  2 projects . 2 agents                    OWN  3 projects . 1 agent          |
|  +--------------------------------------+       +--------------------------------+ |
|  | +--------------+  +--------------+   |       | +--------------+ +-----------+ | |
|  | | api          |  | web          |   |       | | toolkit      | | runtime   | | |
|  | |  .--.        |  |  .--.   .--. |   |       | |  .--.        | |           | | |
|  | | [o o] ...    |  | [o o]/ [- -] |   |       | | [o o] ===    | |  (empty   | | |
|  | | /|__|\  ~~~  |  | /|__|  /|__| |   |       | | /|__|\       | |   desk)   | | |
|  | | typing       |  | waiting idle |   |       | | running      | |           | | |
|  | +--------------+  +--------------+   |       | +--------------+ +-----------+ | |
|  +--------------------------------------+       +--------------------------------+ |
|                                                                                    |
|  3 agents . 1 waiting for you                                                      |
+------------------------------------------------------------------------------------+
```

- A **zone** is a client: a tinted floor area with its name in small capitals.
- A **room** is a project: a walled rectangle with the project key on its door.
- An **agent** sits at a desk inside its room. Its pose is its state; its name and state
  are written under it, so color and motion are never the only signal.
- Clicking a zone name zooms to that client; a breadcrumb `All / ACME` appears top left.
- Clicking an agent opens the agent drawer (section 4).

## 2. Menu drawer

Slides in from the right. One list for all navigation; a section opens in place, and the
drawer widens.

```
                                                   +-------------------------------+
                                                   | Menu                      [x] |
                                                   | Project  [ all projects  v ]  |
                                                   |-------------------------------|
                                                   | WORKSPACE                     |
                                                   |   Floor                       |
                                                   |   Projects                 12 |
                                                   |   Agents                    3 |
                                                   |   Approvals                 1 |
                                                   | PROJECT                       |
                                                   |   Context                     |
                                                   |   Memory                      |
                                                   |   Runs                        |
                                                   |   Tasks                       |
                                                   |   Notes                       |
                                                   | SYSTEM                        |
                                                   |   Settings                    |
                                                   +-------------------------------+
```

A section (UIDL document rendered by `uidl-runtime`):

```
                                     +---------------------------------------------+
                                     | <  Runs . api                          [x]  |
                                     |---------------------------------------------|
                                     | Started      Title                  State   |
                                     | 2026-10-16   Add invoice export     open    |
                                     | 2026-10-12   Fix login redirect     done    |
                                     | 2026-10-09   Migrate to v2 schema   blocked |
                                     |                                             |
                                     +---------------------------------------------+
```

Project sections need a project: the selector at the top of the menu, preset to the
last room or agent clicked on the floor.

## 3. Assistant drawer

Standard AI chat layout. Opened from the assistant icon it works at workspace scope;
opened from an agent it is bound to that agent's project (section 4).

```
                                          +----------------------------------------+
                                          | Assistant              [new] [x]       |
                                          | Scope: Workspace   Model [ echo   v ]  |
                                          |----------------------------------------|
                                          |                                        |
                                          |   Ask about projects, runs, memory,    |
                                          |   or code.                             |
                                          |   [ Summarize active work ]            |
                                          |   [ What is waiting for me? ]          |
                                          |                                        |
                                          |   user > ...                           |
                                          |   assistant > ...  [read_file: done]   |
                                          |                                        |
                                          |----------------------------------------|
                                          | [ Message                      ] (>)   |
                                          +----------------------------------------+
```

## 4. Agent drawer

The assistant drawer bound to one project, with the agent card on top. History is that
project's conversation; it survives switching between agents while the page is open
(server-side history is phase 2).

```
                                          +----------------------------------------+
                                          |  .--.   claude-code . api         [x]  |
                                          | [o o]/  waiting for you . 2 min        |
                                          |  /|__|  approval: run_command          |
                                          |         [ Approve once ]  [ Deny ]     |
                                          |----------------------------------------|
                                          | Chat | Activity | Run                  |
                                          |----------------------------------------|
                                          |   project conversation ...             |
                                          |----------------------------------------|
                                          | [ Message to api               ] (>)   |
                                          +----------------------------------------+
```

## 5. Agent poses

```
 idle        working     thinking     reading     typing      running     learning    waiting     warning     offline
  .--.        .--.        .--. o O     .--.        .--.        .--.        .--.  * .   .--. |      .--. /!\    .--.
 [o o]       [o o]       [o o]        [> >]       [o o]       [o o]       [o o] *     [o o]/     [o o]       [- -]
 /|__|\      /|__|\ ...  /|__|\       /|[]|\      /|__|\      /|__|\ >_   /|[]|\      /|__|      /|__|\      /|__|\
 breathes    dots pulse  bubble       eyes scan   keys tap    terminal    book, sparks hand up   amber mark  grey, still
```

`prefers-reduced-motion` freezes every pose on its first frame; the written state stays.

## 6. Small screens

Below 720px the zones stack in one column, rooms wrap two per row, and every drawer
takes the full width. The two icons stay at the top right.
