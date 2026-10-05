# Idées hors scope

Tout ce qui n'est pas dans le scope actuel. Une idée sort d'ici seulement
quand la spec est mise à jour pour l'inclure.

## Monde vivant

- Éléments qui se propagent d'étage en étage : feu, eau, végétation, corruption.
- Factions : territoires, alliances, guerres entre groupes de créatures.
- Mémoire individuelle : monstres qui se souviennent du joueur, deviennent des rivaux.
- Le donjon continue de vivre quand le joueur est déconnecté (serveur).

## L'île

- Hub entre les runs, en temps réel.
- Rôle à définir : progression, construction, narration.
- Monstres vaincus sans être tués qui rejoignent l'île comme habitants.
- Graines cultivées sur l'île, plantées dans le donjon.

## Concepts grandioses

- L'île repose sur le dos d'un titan endormi ; les donjons sont son corps.
- Combats sur le dos d'un colosse en mouvement : la grille penche et s'effondre.
- L'océan monte à chaque run, l'île rétrécit.
- Un reflet corrompu de l'île sous la mer.

## Mécaniques

- Terrain sculptable : élever ou creuser des blocs.
- Marée qui monte dans le donjon.
- Lumière comme ressource.
- Échos des runs passés qui rejouent leurs actions.
- Morsure via `harm` et carcasses : la prédation blesse au lieu de tuer, le corps reste comme nourriture.
- Les créatures évitent d'entrer dans le feu même sans la peur, quand elles se déplacent pour une autre raison.

## Outillage

- Config en JSON, modifiable sans toucher au code : éditeur de niveaux, modding, réglages à chaud.
- API moteur pour le serveur (snapshots) : lister les entités d'un étage, connaître l'espèce d'une entité, typer le sens des payloads `a`/`b` de chaque événement, exporter `TICKS_PER_TURN` au premier appelant.

## Visuel

- 3D avec textures pixel art, terrain en marches, lumière douce, palette désaturée.
- Modèles faits dans MagicaVoxel.

## Multijoueur

- Modèle de tour à plusieurs joueurs : tours simultanés, minuteur, qui attend
  qui. Le moteur reste neutre : il s'arrête quand un joueur est attendu, le
  serveur fournit les entrées (voir `docs/plans/ecs-core.md`, D13).
- Étages sans joueur qui avancent de façon asynchrone, à un round au plus
  de leurs voisins.
