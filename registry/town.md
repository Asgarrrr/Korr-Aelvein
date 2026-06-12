# La ville

La ville est le personnage principal du jeu. Elle vit entre les descentes — pas en attente, mais activement. Les NPCs ont des routines, des relations, des savoirs et des ignorances. La ville monte et descend en capacité collective selon ce que les générations de joueurs lui ont laissé.

---

## Population et structure

**Taille cible : 15 à 20 personnes nommées.** Au-delà, les individus deviennent des ressources. En deçà, les pertes sont trop rapides et la ville semble vide trop tôt.

Chaque habitant a :
- Un nom
- Un métier (parfois deux si apprentissage en cours)
- Une relation avec 2-3 autres habitants (famille, amitié, tension, dette)
- Une chose qu'ils savent sur l'abysse (pas forcément juste)
- Une chose qu'ils font quotidiennement (observable par le joueur)
- Une posture face à la descente (opposé / résigné / curieux / pragmatique)

La composition de la ville change à chaque génération. Des gens naissent, vieillissent, meurent de causes ordinaires (pas seulement l'abysse). Les enfants deviennent adultes et prennent un métier. La démographie du village a une inertie réelle — une génération sans sage-femme produit des effets visibles deux générations plus tard.

---

## Routines et vie quotidienne

Les habitants de la ville ont des routines (voir `docs/LIVING-WORLD.md` pour l'architecture technique). Depuis le point de vue du design :

**Ce que le joueur observe :**
- La forge qui ouvre ou ferme selon que le forgeron est en vie et en bonne santé
- La bibliothèque accessible uniquement quand le scribe est là
- Le marché qui change d'inventaire selon les descentes récentes
- Les conversations entre habitants aux heures du repas (diegetic information sur la situation)

**Ce que le joueur ne voit pas directement :**
- L'état de santé général de la population
- Les tensions sous-jacentes
- Ce que les habitants savent mais ne disent pas au joueur par défaut

La ville n'attend pas le joueur. Elle continue. Si le joueur ne revient pas pendant un long moment (en temps de jeu), des choses se passent. Pas punitivement — naturellement.

---

## Santé de la ville

La ville n'a pas une "barre de vie". Elle a plusieurs dimensions de santé qui évoluent indépendamment et s'affectent mutuellement :

### 1. Population

Combien de personnes sont en vie, en bonne santé, et capables de leur métier. La population descend (morts, départs, Marques trop lourdes) et monte (naissances, arrivants — rares). Une ville en dessous de 8 personnes commence à avoir du mal à couvrir tous les métiers nécessaires.

### 2. Connaissance collective

Ce que la ville sait sur l'abysse, aggrégé de tous les journaux, traditions et apprentissages. Se mesure non pas en nombre mais en qualité — combien de créatures sont nommées, combien de glyphes sont connus, combien d'affordances de métier sont transmises.

La connaissance collective monte quand des descenders survivent et écrivent, et quand des apprentissages ont lieu. Elle baisse quand des gens morts sans transmission et quand des informations fausses s'accumulent dans la bibliothèque sans être corrigées.

### 3. Ressources matérielles

La forge produit des outils, le jardin de l'herboriste produit des préparations, le menuisier entretient les structures. Si un métier manque, certaines ressources ne se reconstituent pas. La descente devient plus coûteuse en Endurance si les préparations de l'herboriste ne sont plus disponibles.

### 4. Moral collectif

Visible seulement à travers les dialogues et les comportements. Une ville qui a perdu plusieurs descenders récemment est plus silencieuse. Les gens disent moins de choses. Le conteur arrête de raconter des histoires du passé et ne raconte que les récentes pertes. Ce n'est pas un chiffre — c'est un ton.

Le moral bas ne produit pas de "malus de stats" directs. Il produit moins d'information disponible, moins de coopération spontanée, des NPCs moins enclins à donner ce qu'ils ont.

---

## Ce que le joueur peut faire dans la ville

### Avant une descente

- **Parler aux habitants** — chaque habitant a une ou deux choses à dire sur l'état actuel, sur ce qu'il a observé au rebord, sur des rumeurs. Certaines informations ne sont données qu'à des joueurs ayant un rapport préexistant avec cet habitant.
- **Consulter la bibliothèque** — lire les journaux disponibles, copier des noms, croiser des informations. Le scribe peut aider à identifier les textes difficiles.
- **Préparer avec l'herboriste** — acheter/recevoir des préparations (ralentissement d'Endurance, traitement de Marques légères). Disponible seulement si l'herboriste est en vie et a des stocks.
- **Faire affûter ses outils** — le forgeron peut améliorer certains objets portés. Certaines améliorations donnent accès à des réponses supplémentaires dans l'abysse.
- **Désigner un apprenti** — si le personnage a une affordance de métier à transmettre et qu'un apprenti est disponible, entamer la transmission. Prend du temps (plusieurs cycles).

### Après une descente

- **Déposer son journal** à la bibliothèque (ou en garder un sur soi pour la prochaine)
- **Rapporter des observations** — la ville peut les consigner dans ses registres
- **Traiter ses Marques** — avec la sage-femme ou l'herboriste, selon la nature des Marques
- **Partager un nom trouvé** — le dire au conteur ou l'écrire le rend accessible à la génération suivante

### En permanence

- **Observer** — les changements dans les routines, les conversations, les comportements sont de l'information sur l'état de la ville
- **Construire des relations** — certains habitants ne donnent de l'information pertinente qu'à quelqu'un en qui ils ont confiance. La confiance se construit par la présence, pas par des quêtes.

---

## Incursions

Quand l'archive déborde, des créatures remontent dans la ville. Ce n'est pas un "événement de gameplay" déclenché par le jeu — c'est la conséquence logique d'une pression trop haute dans l'archive.

**Signaux d'alerte (diegétiques) :**
- Sons au rebord la nuit
- Traces dans la neige le matin
- Un éclaireur qui ne revient pas de sa ronde
- La tisserande qui ne fabrique plus que des linceuls
- Le fossoyeur qui commence à creuser sans qu'on lui ait demandé

**Ce qui se passe lors d'une incursion :**
Une ou plusieurs créatures sont dans la ville. Elles se comportent selon leurs états habituels (pas d'IA spéciale pour les incursions — ce sont les mêmes créatures dans un nouvel espace). Les habitants qui n'ont pas de métier lié à l'abysse se barricadent. Le joueur peut s'engager ou non. Certains NPCs peuvent être blessés ou tués si le joueur n'intervient pas.

**Le choix :** Certaines créatures en incursion sont des Effacés — des répliques en cours de suppression qui cherchent quelque chose. Les attaquer n'est pas toujours la réponse. Le fossoyeur peut les "enterrer". Le prêtre peut les apaiser avec un chant. Le conteur peut les nommer. Chaque solution produit un résultat différent et laisse une trace différente dans l'archive.

---

## La chute de la ville

La ville peut tomber. Pas par un "game over" abrupt — par un effondrement progressif.

La ville tombe quand : la population descend en dessous de 4-5 personnes, ou quand une incursion majeure n'est pas gérée, ou quand une pression archivale extrême (les Effacés arrivent en masse parce que l'archive efface en urgence) dépasse les capacités de la ville.

La chute n'est pas une punition — c'est un état narratif. La ville disparaît dans l'archive. Les derniers habitants sont enregistrés. Et peut-être, dans une partie future, quelqu'un descend assez loin pour trouver leur écho.

---

## Ce qui change entre les générations

Chaque mort, chaque naissance, chaque décision laisse une trace dans la ville. Des traces concrètes :

- **Les bâtiments** : la forge d'un forgeron mort sans successeur commence à se délabrer. Après deux générations, elle n'est plus fonctionnelle.
- **La bibliothèque** : s'enrichit si les descenders écrivent et déposent. Se dégrade si personne ne prend soin des textes les plus fragiles.
- **Les rituels** : certains rituels de la ville se maintiennent parce que quelqu'un les transmet. Si personne ne prend la relève, ils s'arrêtent. La ville devient légèrement moins armée contre l'abysse (certaines protections rituelles cessent de fonctionner).
- **Les noms sur les murs** : les morts dont on se souvient sont gravés sur le mur du fossoyeur. Quand le mur est plein, les noms les plus anciens sont effacés pour faire de la place. La ville oublie.
