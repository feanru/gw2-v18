# Backend API Endpoints

## dataBundle.php

Endpoint: `/backend/api/dataBundle.php?ids[]=123&ids[]=456`

Returns an array where each element contains minimal data for an item:

```
[
  {
    "id": 123,
    "item": {
      "id": 123,
      "name": "Item name",
      "icon": "https://.../icon.png",
      "rarity": "Rare"
    },
    "recipe": {
      "output_item_count": 1,
      "ingredients": [
        { "item_id": 456, "count": 2 },
        { "item_id": 789, "count": 1 }
      ]
    },
    "market": {
      "buy_price": 100,
      "sell_price": 120
    }
  }
]
```

In addition to the fields used by the frontend (`items-core.js` and `recipeService.js`),
an `extra` object with metadata like `last_updated` is included.

- **item**: `id`, `name`, `icon`, `rarity`
- **recipe**: `output_item_count`, `ingredients[]` (`item_id`, `count`)
- **market**: `buy_price`, `sell_price`
- **extra**: `last_updated`

