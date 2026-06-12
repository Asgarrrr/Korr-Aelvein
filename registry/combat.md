# Système de combat

## Philosophie

L'abysse ne veut pas tuer. Elle archive. Les créatures qu'on y rencontre sont des processus — primitifs, instinctifs, sans intention. Ce ne sont pas des antagonistes. Ce sont des organismes dont la présence physique est létale de la même façon qu'un feu est létal : sans volonté, sans cible, sans haine.

On peut les tuer. Ce n'est pas interdit, pas immoral, pas puni. C'est simplement souvent sous-optimal — une créature tuée avant qu'on l'ait observée en Épuisée est une créature dont on n'apprend rien. Et elles apprennent, elles.

---

## Présence

Chaque créature a une **Présence** — la densité de sa manifestation physique dans l'abysse. C'est ses points de vie. Quand la Présence tombe à zéro, la créature se dissout. Elle ne meurt pas au sens propre — elle retourne dans l'archive. Certaines réapparaîtront. Certaines ne réapparaîtront pas.

La Présence se réduit par :
- Les actions directes du joueur (armes, outils utilisés offensivement)
- Certaines réponses métier (le forgeron peut déstructurer le matériau d'une créature ; le fossoyeur peut précipiter l'effacement d'un Effacé)
- L'environnement dans certaines zones (des zones de haute instabilité archivale dégradent la Présence des Effacés)

Une créature dont la Présence est réduite à 30% ou moins entre dans un état de détresse — elle émet un **signal de menace** et son comportement change (voir *Apprentissage* ci-dessous). Certaines fuient. Certaines appellent.

---

## Les états comportementaux

Les états définissent le mode d'opération de la créature à un instant donné. Ils déterminent son comportement, pas sa dangerosité brute — une créature en Filtrage peut tuer un joueur qui l'ignore.

### Filtrage

Fonction d'archive de base. Trajectoires régulières, pas de détection active. Le danger est indirect : être dans sa trajectoire, c'est être traité.

*Dommages :* Contact passif — 1 point d'Intégrité par tour de contact. Pas une attaque.

*Sortie :* Perturbation suffisante (bruit, mouvement brusque, modification de l'environnement) → Sondage.

---

### Sondage

Anomalie détectée. La créature enquête. Elle ne cherche pas à tuer — elle cherche à déterminer si l'anomalie est archivée. Si la réponse est non, elle passe en Expression.

*Dommages :* Aucun dommage direct. Présence du joueur comme anomalie active → tension croissante.

*Sortie :*
- Joueur identifié comme archivé (nommage correct, objet connu, réponse métier adaptée) → retour en Filtrage
- Anomalie confirmée non-archivée → Expression
- Présence réduite à 30% pendant le Sondage → signal de menace + comportement adapté (espèce-dépendant)

---

### Expression

La créature s'exprime pleinement. C'est son mode d'engagement maximal — thématiquement cohérent avec ce qu'elle archive, physiquement dangereux.

*Dommages :* Contact direct → dommages d'Intégrité importants (variable par espèce). Présence dans l'espace d'une créature en Expression → perte de Concentration par tour.

*Combat direct :* La créature en Expression est la seule où frapper en premier a un sens tactique. Réduire sa Présence rapidement peut forcer l'Épuisée avant qu'elle inflige ses dommages complets.

*Sortie :*
- Présence à zéro → dissolution
- Nommage correct → Épuisée immédiate
- Présence à 30% → signal de menace, comportement adapté
- Cycle naturel épuisé → Épuisée

---

### Épuisée

La créature a dépensé son Expression. Inerte. Elle ne traite plus rien. C'est l'état maximal d'information — plusieurs réponses métier ne sont disponibles que sur une créature Épuisée.

*Dommages :* Aucun. Contact possible sans conséquence.

*Valeur :* Lire ce qu'une créature archive, apprendre des fragments de son nom, exploiter les réponses métier spécifiques à cet état.

*Retour :* Les créatures Épuisées retournent en Filtrage après un nombre de tours variable. Ne pas laisser une Épuisée sans l'avoir lue si c'est l'objectif de la descente.

---

## Apprentissage et adaptation

Les créatures de l'abysse apprennent. Pas par intelligence — par conditionnement. Chaque espèce accumule une **mémoire collective** (côté serveur, persistante entre les descentes) qui modifie ses paramètres comportementaux au fil des rencontres.

### Ce qui change avec l'expérience

**Distance de réaction.** Une espèce régulièrement attaquée à portée courte commence à maintenir une distance plus grande avant de passer en Sondage.

**Seuil de fuite.** Une espèce dont beaucoup d'individus ont été tués apprend à fuir plus tôt. La Présence seuil qui déclenche le signal de menace baisse.

**Formation.** Une espèce dont les individus isolés sont systématiquement éliminés développe une tendance à ne jamais être seule — les individus restent à portée de signal même en Filtrage.

**Adaptations spécifiques.** Une espèce systématiquement attaquée avec la même arme ou la même réponse métier développe une résistance comportementale : elle change de vecteur d'approche, elle évite l'angle d'attaque habituel, elle priorise la cible qui porte l'outil en question.

### Ce que le joueur observe

Les premières descentes : comportement archétypal, prévisible.

Après plusieurs rencontres avec la même espèce : des glissements. Le Géomètre commence ses cercles de Sondage plus loin qu'avant. La Voisine approche maintenant par des angles plutôt que directement. Une espèce qui était toujours solitaire commence à apparaître par deux.

Après des dizaines de descentes : certaines tactiques ne fonctionnent plus. Le joueur doit s'adapter — ou apprendre quelque chose de nouveau sur la créature.

### Ce qui peut réinitialiser une espèce

Nommer correctement plusieurs individus d'une espèce "acquitte" leur enregistrement dans l'archive. Une espèce dont les individus ont été correctement nommés et enterrés peut voir sa mémoire collective se dissoudre partiellement — elle redevient moins adaptée, plus prévisible. C'est l'un des effets durables du travail du fossoyeur sur l'état de l'abysse.

---

## Comportements de groupe

### Le signal de menace

Quand une créature passe sous 30% de Présence ou est tuée, elle émet un **signal de menace**. Ce signal n'est pas verbal — c'est un état que les créatures voisines perçoivent comme une perturbation de l'espace archival.

*Portée :* Variable par espèce. Certaines propagent le signal loin (les espèces qui ont développé cette capacité après des pertes répétées). Certaines ne le propagent pas du tout.

*Effets sur les créatures voisines de la même espèce :*
- Passage en Sondage actif si elles étaient en Filtrage
- Formation de groupe si leur tendance de groupe est suffisamment développée
- Fuite dans les espèces à seuil de fuite bas

*Effets lisibles pour les métiers :*
- **Éclaireur :** voit le changement de trajectoire avant qu'il se produise
- **Fossoyeur :** entend l'écho du signal — peut estimer le nombre de créatures qui l'ont reçu
- **Forgeron :** perçoit une variation dans la densité matérielle de l'espace — le signal a une texture

### Meutes

Les meutes ne sont pas des groupes fixes. Elles se forment en réponse à un signal de menace suffisamment fort, puis se dispersent quand la menace disparaît.

*Formation :* 2 à 5 individus de la même espèce qui ont reçu le même signal. Ils convergent vers la source.

*Comportement en meute :* Approche coordonnée — pas stratégique, mais les individus naturellement couvrent des angles différents parce qu'ils convergent depuis des positions différentes. L'effet est celui d'un encerclement sans que ce soit intentionnel.

*Rupture de meute :* Tuer l'individu qui a émis le signal original disperse souvent les autres. Les individus isolés sans signal actif retournent en Filtrage.

### Fuite

Les créatures fuient quand leur Présence est suffisamment basse et que leur espèce a appris à fuir. Ce n'est pas une capitulation — c'est de la survie instinctive.

*Ce qui se passe :* La créature s'éloigne de la source de dommage. Si d'autres créatures sont dans son chemin de fuite, elle les "touche" — signal de menace transmis au contact.

*Ce qu'on perd :* Une créature qui fuit n'entre pas en Épuisée naturellement. Si on veut l'observer, il faut la suivre ou la laisser s'épuiser ailleurs — ce qui peut la mener dans des zones inattendues.

*Voie d'éclaireur :* L'éclaireur peut anticiper la direction de fuite avant que la créature fuie. Désigner cette direction comme route de retraite pour soi ou zone à éviter.

---

## Ressources du joueur

Trois ressources. Aucune n'est une "vie".

### Endurance

Ce que le corps peut maintenir. Se dépense avec le temps dans l'abysse, l'effort physique, le combat direct (courir, frapper, fuir). *Ne se dépense pas passivement au combat* — mais poursuivre ou fuir une créature en Expression est physiquement coûteux.

*Seuil critique :* En dessous d'un quart, le mouvement devient coûteux. En dessous d'un dixième, courir est impossible. À zéro : effondrement sur place.

---

### Concentration

L'attention dirigée. Se dépense dans les engagements actifs, les tentatives de nommage, la lecture de glyphes, la pression de présence d'une créature en Expression.

*Seuil critique :* À zéro, le nommage échoue. Plusieurs réponses métier ne sont plus disponibles. La fuite reste possible.

---

### Intégrité

La cohérence du joueur dans l'environnement archival. Se perd au contact d'une créature en Expression, dans les zones de haute densité, lors de certains glyphes.

*Récupération :* Ne récupère pas sans traitement (herbalist, sage-femme).

*Les Marques :* Sous un seuil, le joueur reçoit une Marque permanente — un coût réel et un accès réel, indissociables. Exemples :

- *Vous avez descendu trop loin une fois. Vous entendez maintenant les pierres parler. Mais le sommeil ne vient plus facilement.*
- *Vous avez touché l'écho du noyé. Vous pouvez passer les portes scellées. Mais votre ombre ne vous suit plus exactement.*

---

## Le nommage dans l'engagement

Connaître le nom d'une créature court-circuite la nécessité du combat. C'est le chemin de la connaissance, pas du bras.

| État | Effet du nommage correct |
|---|---|
| Filtrage | La créature vous inclut dans son filtre comme élément connu. Elle vous ignore pour ce cycle. |
| Sondage | La créature conclut que vous êtes archivé. Retour en Filtrage. |
| Expression | Interruption immédiate. Transition directe vers Épuisée. |
| Épuisée | Aucun effet. Elle ne traite plus. |

**Le mauvais nom** en Sondage : escalade directe vers Expression.

**Le nom partiel** en Sondage : Sondage ralenti. L'escalade est retardée, pas évitée.

Les créatures qui ont appris à reconnaître certaines tactiques réagissent différemment au nommage d'espèces proches — un nom qui ressemble sans être exact peut déclencher une méfiance accrue chez une espèce ancienne.

---

## La mort

Un personnage meurt de : Endurance à zéro avec une menace active à portée, accumulation de Marques au-delà de la capacité du corps (entre 3 et 5 selon le personnage), ou contact prolongé avec un Effacé.

**Dans l'abysse :** Le corps reste. Korr enregistre le moment. Une réplique apparaîtra éventuellement, quelque part dans les profondeurs.

**Dans la ville :** Si le personnage ne remonte pas, la ville l'inscrit dans ses registres. Les sons de l'abysse changent légèrement lors d'une mort en profondeur.

**Ce que le joueur suivant trouve :** Le corps (lootable), le journal, une Marque possible sur l'écho. La position de la mort dans les registres si quelqu'un l'a déduite.

---

## Récompense par descente

Chaque descente doit se terminer avec au moins une victoire lisible à court terme :

- Un nom complet appris — le joueur peut nommer une créature en Sondage et voir la transition se produire
- Une créature mise en Épuisée définitive pour la première fois — état observable et exploitable librement
- Un objet dont l'effet dans la ville est visible au retour
- Un comportement nouveau d'une espèce noté dans le journal — signe visible que l'apprentissage a progressé

Sans ça, le jeu sera satisfaisant pour les lore-hunters et lent pour tout le monde.
