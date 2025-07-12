# Description

Yu-Gi-Oh! probability estimator for deck consistency

## Setting up

1. Install git
   - Windows: Follow [the instruction](https://git-scm.com/downloads/win)
   - Linux: If you use linux you can probably figure it out
2. Install python with the version in `.python-version`. I recommend using uv to simplify installation. You can follow [uv installation instruction](https://docs.astral.sh/uv/getting-started/installation/) to install it into your machine. For Windows user I recommend using [winget method](https://docs.astral.sh/uv/getting-started/installation/#winget)

## Usage

### Probability calculator

1. Prepare a deck file. You can check the `sample.toml` file that I've created for how to create the deck file
2. Open a terminal and run the below command for calculating the probablity of the deck:

   ```bash
   uv run main.py probability --deck sample.toml
   ```

3. The results should look like this:

   ```bash
   None-engine card ratio is: 11/44
   Probability of success main deck with hand of 5: 83.98%
   Probability of success side deck with hand of 6: 86.83%
   ```

### Combination generator

This helper function is for finding a list of combination from 2 card combo

1. Prepare a file with the combination field like in the `sample.toml` file
2. Open a terminal and run the below command, it will list out all the 2 card combinations from the input list

   ```bash
   uv run main.py combination --file sample.toml
   ```

3. The results should contains all the combinations of 2 card combo that you want

   ```bash
   Chef AND Pois
   Chef AND Menu
   Chef AND Concours
   Chef AND Diviner
   Chef AND Angry
   Chef AND Restaurant
   Pois AND Menu
   Pois AND Concours
   Pois AND Diviner
   Pois AND Angry
   Pois AND Restaurant
   Menu AND Concours
   Menu AND Diviner
   Menu AND Angry
   Menu AND Restaurant
   Concours AND Diviner
   Concours AND Angry
   Concours AND Restaurant
   Diviner AND Angry
   Diviner AND Restaurant
   Angry AND Restaurant
   ```

### Updating the program

1. To get new release of the program, you can run the following command inside the folder:

   ```bash
   git pull
   ```

## Notes

- I forked this from [flipflipshift](https://github.com/flipflipshift/BasicYGOSim), many thanks for the inspiration
- I decided to fork this repository for my personal usage. The original scripts, while convenient by allowing running on browsers, make it hard to maintain multiple deck list, so I forked it and make it work on local machine instead
