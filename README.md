# LLM-Academic-Writing
This public repository studies how we can leverage Large Language Models (LLMs) as tools to enhance academic writing. We collect useful resources and develop tools that utilize LLMs to improve academic writing skills.

[![My Skills](https://skillicons.dev/icons?i=rocket)](https://skillicons.dev) 

**Featured tools.**
- [GPT4Reviewer](https://github.com/dixiyao/LLM-Academic-Writing/blob/main/GPTReviewer). A practical tool that uses GPT-4 to generate paper reviews. You can also use GPT4 Reviewer to receive suggestions for improving your paper based on a structured review template. Modify the [suggestion template](https://github.com/dixiyao/LLM-Academic-Writing/blob/main/Prompts/suggestion_template.yml) to tailor it to your needs.
- [GrammarCheck](https://github.com/dixiyao/LLM-Academic-Writing/blob/main/GPTReviewer). We can also use the reviewer tool to check the grammar and usage of English. Typically, it is better to use tools such as [Writer](writer.com) or Grammarly to check the spelling and grammar of the paper. However, we can also leverage GPT to ensure that the usage of English is correct. This is very helpful for non-native speakers.

## Choice of LLMs
#### Generative LLMs
- [ChatGPT 3.5/4.0](https://chat.openai.com/)-the most widely used tool
- [Llama3-8B (BF16)](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
- [Octopus-v2](https://github.com/dixiyao/LLM-Academic-Writing/blob/main/GenerativeLLM/octopus.py)

#### Documentation Reading
- [Scispace](https://typeset.io/)
- [LayoutLM ](https://huggingface.co/impira/layoutlm-document-qa)

## Tools
### GPT Reviewer
- [GPT4Reviewer](https://github.com/dixiyao/LLM-Academic-Writing/blob/main/GPTReviewer) Featured tool that generates reviews using GPT-4, based on the paper and a provided review template.
- [GrammarChecker](https://github.com/dixiyao/LLM-Academic-Writing/blob/main/GPTReviewer).
### Prompt Engineering
Suggestions on prompt engineering from OpenAI: [link](https://platform.openai.com/docs/guides/prompt-engineering/six-strategies-for-getting-better-results).

There is also a template for using our developed tools to generate suggestions for your paper: [suggestion template](https://github.com/dixiyao/LLM-Academic-Writing/blob/main/Prompts/suggestion_template.yml)

Helpful prompts for revising academic papers include:
- "Check the grammar, make my language more professional, and sound like a native speaker."
### Frameworks to Run LLMs locally

## Some Interesting Study
- [An assignment using LLMs to revise essays.](https://wac.colostate.edu/repository/collections/textgened/rhetorical-engagements/using-llms-as-peer-reviewers-for-revising-essays/)
- [Experiment with using LLMs to review papers.](https://github.com/Weixin-Liang/LLM-scientific-feedback) You might compare the reviews with those from peer-reviewed venues.
- [ReviewerGPT?](https://arxiv.org/pdf/2306.00622.pdf)

## Citation
```
@misc{
    author={Dixi Yao},
    title={{LLM}s for academic writing},
    url={\url{https://github.com/dixiyao/LLM-Academic-Writing}},
}
```
*LICENSE*: We use the Apache 2.0 license instead of the MIT License.

# Collaboration
Contributions and collaborations are welcome. Any improvements made via pull requests and collaborations will be appreciated.