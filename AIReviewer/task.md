In this AIReivewer Project, we are going to build an AI review system:

Literature review:
    There are a lot of very good existing LLM review tools:
        - https://paperreview.ai/: This is the most talked one but it has the issue that it will hallucinate a lot of helpless but very harsh reviews to mimic those reviewers rather than giving the truly support
        - https://blog.neurips.cc/2026/04/21/neurips-supports-authors-with-googles-paper-assistant-tool-pat/: This is the idea of google PAT.  It can proof-read the paper and find out any in-consistent writing, not mentioned but important related work, and check claims and experiment settings. Some reviews are like human reviewer #2
        - This is the usual prompt I used for LLMs: Please complete following task: 1. First, image you are a NeurIPS 2026 reviewer (e.g. second reviewer) and review the given paper. Please follow the reviewer guideline: https://neurips.cc/Conferences/2026/ReviewerGuidelines and be professional 2. You may be a more harsh reviewer so that you can suggest all potential weakness reviewer may raise.  Hence we can find out what extra content we can do to address them before submission.,espcially for some things we cannot easily address in rebuttal.

Your task:
    We need to build an AI agentic review system:
    1. Frontend, use npm to build a nice UI. We can use the localhost to access it. It should have following important modules. First, a place to upload the pdf versino of the paper. Second, a place that user can input somthing to interact which I will talk about this more. Third, there should be a option list to choose which venue user want to use. 
    2. Backend, the backend have following part:
       1. Interface with AI agents. We use our own agent here. You may refer to the implementation of OpenClaw or the source code of Claude to make sure we can have a multi-round or even multi character multi-agent system
       2. We should support API at least for gemini and openrouter. The interface to use ai agent should support multimodal as we may need to upload pdf, pictures ,tables and files and text into the API. The user will also upload multi-modal content in the chatbox.
       3. The user will upload a Pdf, call the API interafce to upload the pdf and use particular multi-agent system to review the paper
       4. For the feedback, we need at least several agents:
          1. - a review agent which can simulate an ordinary review
          2. - a review agent which simulate random or very hard reviewer
          3. - a simulated ac review to summarize and give determination whether the paper has reach the bar of the venue
          4. - an analyzer review which can give suggestions on weakness of how to improve the paper
       5. the user can select the venue, for initial version, we provide ICLR, NeurIPS, and ICML where you should put the link of these conferences guidlines url or conte t in some palce
       6. For the multi-agent generated feedback, parse it into several part:
          1. give the user a place to view the complete review
          2. for the suggestions, it is usually corresponding to some particular part, for example. If the item in weakness is the general comment. keepit .If the item in weakness is corresponding to which section or which part or which sentence of the pdf paper, please mark/highlight in the pdf in the display window and show the commetn over there. Like a human reviewer who are annotating the pdf. You may need to search on the website to find if there is any tools can realize that functionality where we can parse reviews and weakness and highlight at corresponding place in the pdf.
       7. User can also have a chance to rebuttal:
          1. First user can use the general chat place to interact with the AI to rebuttal some thigns and AI will justify to see if the suggestion is correct and reasonable and revise the review and suggestion
          2. user can also select specific sentences in the paper to rebuttal back. For example, if the review says xxx is missing, user may highlight a part or a sentence in the paper to rebuttal saying that here it is. Then the Agentic reviewer needs justify whether the user rebuttal makes sense or actually the required experiment or claim is stil missing. 
       8. The AI shuold have the memory ability to remember past conversation, the assistant can use some compaction technique like claude compaction, cod or others to compact the context
       9. For each agent in the multi-agent, the prompt to handle user rebuttal and the prompt to revise review, giving suggestion, please carefully curate the prompt
       10. For the first of generating the review. You may refer to the prompt of past ai agentic work but here are following things:
           1.  The ai review chance is not to mimic a human reviewer, it is to generate good review which help the authors have a paper having the best chance to get acceptabed
           2.  Ai review need to have search ability to cehck related work
           3.  AI reviewer needs to give concerete suggestion, especially regarding to experiemnts
           4.  regarding the novelty, ai reviewer can tune down some weights