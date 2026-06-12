# Le premier décès conçu

Un document de design critique identifié après revue adversariale : le jeu demande un contrat implicite au joueur (observer patiemment, noter, transmettre, accepter la récompense différée) sans jamais l'articuler à l'écran. Le premier décès doit enseigner ce contrat par l'expérience, pas par le texte.

---

## Le problème

Korr Aelvein suppose un type de joueur — patient, attentif, disposé à des retours lents — sans onboarder ce joueur. Un joueur qui entre avec les habitudes d'un roguelike classique (mourir → progresser → reessayer mieux → arc satisfaisant en deux heures) va se heurter à un jeu qui refuse ses réflexes sans explication.

La solution n'est pas un tutoriel textuel. C'est une première mort conçue.

---

## Le personnage de départ

Le tout premier personnage que le joueur incarne n'est pas aléatoire. C'est **Lenne, la fossoyeuse**.

Pourquoi Lenne :
- Le fossoyeur est le métier qui accède le mieux à la compréhension des créatures (il entend les enregistrements)
- C'est un métier dont la fonction quotidienne (enterrer les morts) est immédiatement compréhensible
- Son rapport aux morts est direct — ça préfigure exactement ce que le jeu va demander

Lenne a soixante ans. Elle a creusé toutes les fosses de la ville depuis trente ans. Elle est la personne que tout le monde connaît et que personne ne vraiment connaît. Elle n'a jamais descendu.

Elle descend parce que quelqu'un qu'elle a enterré la semaine passée est remonté. Elle l'a vu ce matin au rebord. Elle est la seule qui l'ait reconnu.

---

## Structure de la première descente

**Phase 1 — La rencontre (1er niveau)**

Lenne entre dans l'abysse. Le premier espace est simple. Elle rencontre une créature en Filtrage — Les Courses, le son de pluie qui traverse le couloir.

Rien ne lui dit quoi faire. Elle peut attendre, avancer, essayer de traverser. Si elle traverse (comportement naturel du joueur pressé), elle perd de l'Intégrité. Pas beaucoup — juste assez pour que quelque chose s'affiche : "quelque chose vous a traversée".

Si elle attend et observe (comportement patient), elle voit le pattern. Le jeu ne récompense pas immédiatement — mais la créature ne l'attaque pas. Elle est debout de l'autre côté, indemne. Ce moment enseigne : observer avant d'agir.

**Phase 2 — La reconnaissance**

Au deuxième espace, Lenne trouve ce qu'elle cherchait : l'écho de celui qu'elle a enterré.

L'écho fait les gestes de sa mort — pas de violence, pas de conflit. Un vieux pêcheur qui se noie dans une eau qui n'est pas là. C'est visible, c'est clairement lui, et c'est clairement quelque chose qui n'est pas lui.

Trois options possibles :
1. S'approcher — l'écho entre en Sondage puis Expression si Lenne s'approche trop vite. L'Intégrité baisse. Le jeu ne dit pas pourquoi.
2. Nommer — Lenne connaît le nom de cet homme. Si le joueur l'entre (après avoir lu que Lenne "connaît son nom" depuis les premières lignes de la descente), la créature entre en Épuisée. Rien d'autre ne se passe. Mais c'est un moment.
3. Enterrer — l'affordance de départ du fossoyeur. Lenne peut effectuer un geste d'enterrement. L'écho disparaît. Quelque chose se stabilise dans la zone.

Le jeu ne dit pas quelle option est "bonne". Toutes les trois fonctionnent différemment. Mais le nommage et l'enterrement récompensent l'observation préalable (avoir lu les descriptions, avoir compris que Lenne connaissait cet homme). L'approche directe coûte.

**Phase 3 — La descente et la limite**

Lenne continue. Elle trouve deux créatures de plus — un Filtreur, une Sonde. Elle gère ou non. Au troisième espace, son Endurance est suffisamment basse pour que le jeu commence à signaler un retour nécessaire.

Si le joueur pousse trop loin, Lenne meurt d'épuisement dans l'abysse. Si le joueur revient à temps, Lenne revient et peut écrire dans son journal.

**Phase 4 — La mort de Lenne (conçue)**

Lenne meurt au retour à la ville, pas dans l'abysse. De mort naturelle. Elle était vieille, elle est descendue une fois, ça l'a épuisée.

Ce décès arrive après que le joueur soit revenu de la descente. Il a peut-être écrit dans son journal. Ou non.

L'écran de mort de Lenne affiche :
- Ce que la ville retient d'elle (les fosses qu'elle a creusées, le registre funéraire qu'elle maintenait, l'apprentissage éventuel qu'elle a donné)
- Ce qui est perdu avec elle (si aucun apprenti — "personne ne sait plus comment creuser à la lèvre de façon correcte")
- Ce qu'elle a vu dans l'abysse, si le journal a été rempli — ou "elle n'a pas écrit ce qu'elle a trouvé"

Cette asymétrie — avoir écrit vs ne pas avoir écrit — est la première fois que le contrat implicite du jeu s'affiche explicitement.

---

## Ce que cette séquence enseigne

Sans texte tutorial, sans liste d'instructions :

1. **Observer avant d'agir** — Les Courses enseigne ça en premier.
2. **Le métier change ce qu'on perçoit** — Lenne entend l'écho différemment d'un forgeron.
3. **Nommer est un pouvoir** — La reconnaissance de l'écho le rend gérable.
4. **L'Endurance est la vraie limite** — Pas les combats. Le temps.
5. **Écrire a de la valeur** — L'écran de mort de Lenne le montre concrètement.
6. **La mort n'est pas une punition** — Lenne meurt de vieillesse. Sa mort est naturelle. Le jeu la traite avec respect.

---

## La suite — Vael, l'éclaireur

Le personnage suivant est Vael, un éclaireur de trente ans qui a lu le registre de Lenne. Il descend avec ses informations — ses observations dans le journal si Lenne a écrit, ou sans elles si Lenne n't a pas écrit. La différence est tangible.

Ce deuxième personnage enseigne ce que l'héritage signifie concrètement. Vael n'est pas une "nouvelle vie" de Lenne — il est une personne différente avec un métier différent. Ce qu'il voit dans l'abysse est différent. Ce que Lenne lui a laissé (ou non) change exactement ça.

---

## Ce que cette séquence n'est pas

Pas un tutoriel au sens classique. Il n'y a pas d'interface qui dit "appuyez sur X pour faire Y". Pas de flèches. Pas de messages "bravo".

C'est une histoire conçue qui installe les bons comportements par l'expérience sans jamais les nommer. La distinction est importante — un tutoriel dit au joueur quoi faire. Cette séquence lui montre pourquoi.
