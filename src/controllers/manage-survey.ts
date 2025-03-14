import { Router } from 'express';

import asyncWrapper from '../utils/async-wrapper.ts';
import auth from '../middleware/auth.ts';
import { UserSurvey, UserSurveyStatus } from '../models/userSurvey.ts';
import { Question } from '../models/question.ts';
import { Answer } from '../models/answer.ts';
import { User } from '../models/user.ts';
import { Survey, SurveyStatus } from '../models/survey.ts';
import { Category } from '../models/category.ts';

const router = Router();

const getUserByEmail = async (email: string) => {
  return User.findOne({ where: { email } });
};

// create a survey (admin)
router.post(
  '/survey',
  auth,
  asyncWrapper(async (req, res) => {
    const creatorEmail = req.body.jwt.email;
    const { questions, categoryIds } = req.body;

    const creator = await getUserByEmail(creatorEmail);

    if (!creator || creator.role !== 'admin') {
      return res.status(403).send({
        success: false,
        message: 'Permission denied',
      });
    }

    await Survey.createNewSurvey({
      title: req.body.title,
      questions,
      categoryIds,
    });

    return res.status(200).send({
      success: true,
      message: 'Survey created successfully',
    });
  })
);

// invite user to survey, only if survey is in Published state
router.post(
  '/survey/:id/invite',
  auth,
  asyncWrapper(async (req, res) => {
    try {
      const { jwt, inviteeEmail } = req.body;
      const { id: surveyId } = req.params;
      const requestorEmail = jwt.email;

      // Validate requestor role
      const user = await getUserByEmail(requestorEmail);

      if (!user || user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Permission denied',
        });
      }

      // Validate invitee user
      const invitee = await getUserByEmail(inviteeEmail);

      if (!invitee) {
        return res.status(404).json({
          success: false,
          message: 'Invitee user not found',
        });
      }

      // Validate survey existence and status
      const survey = await Survey.findOne({
        where: { id: surveyId },
      });

      if (!survey) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found',
        });
      }

      if (survey.status === SurveyStatus.DRAFT) {
        return res.status(403).json({
          success: false,
          message: 'Survey has not been published yet',
        });
      }

      // Create UserSurvey entry
      const userSurvey = await UserSurvey.create({
        userId: invitee.id,
        surveyId: survey.id,
      });

      return res.status(200).json({
        success: true,
        message: 'User invited to the survey successfully',
        userSurvey,
      });
    } catch (error) {
      console.error('Error in /survey/:id/invite:', error); // Log error for debugging

      // Return a generic error message
      return res.status(500).json({
        success: false,
        message: 'Internal server error. Please try again later.',
      });
    }
  })
);

// route to fill out the user survey or submit it (for invited users)
router.put(
  '/survey/:id',
  auth,
  asyncWrapper(async (req, res) => {
    const requestorEmail = req.body.jwt.email;
    const { id } = req.params;
    const answers: { answer: string; questionId: number }[] = req.body.answers;

    const user = await getUserByEmail(requestorEmail);

    if (!user || user.role !== 'user') {
      return res.status(403).json({
        success: false,
        message: 'Permission denied',
      });
    }

    const userSurvey = await UserSurvey.findOne({
      where: { id, userId: user.id },
    });

    if (!userSurvey) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this survey',
      });
    }

    if (userSurvey.status === UserSurveyStatus.submitted) {
      return res.status(403).json({
        success: false,
        message: 'This survey cannot be edited anymore',
      });
    }

    const incomingAnswers = Array.isArray(answers) ? answers : [];

    const survey = await userSurvey.getSurvey();
    const surveyQuestions = await survey.getQuestions();
    const requiredQuestionIds = surveyQuestions.map((q) => q.id);

    if (
      incomingAnswers.some(
        ({ questionId }) => !requiredQuestionIds.includes(questionId)
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Some answers contain invalid question IDs that do not belong to this survey.',
      });
    }

    const userSurveyAnswers = await userSurvey.getAnswers();
    const currentUserSurveyAnswerQuestionIds = userSurveyAnswers.map(
      (answer) => answer.questionId
    );

    const answeredQuestionIds = new Set([
      ...currentUserSurveyAnswerQuestionIds,
      ...incomingAnswers.map((a) => a.questionId),
    ]);

    // Check if all required questions have been answered
    const allQuestionsAnswered = requiredQuestionIds.every((qId) =>
      answeredQuestionIds.has(qId)
    );

    if (
      !allQuestionsAnswered &&
      req.body.status === UserSurveyStatus.submitted
    ) {
      return res.status(400).json({
        success: false,
        message: 'All questions must be answered before submitting.',
      });
    }

    if (
      userSurvey.status === 'draft' &&
      req.body.status === UserSurveyStatus.submitted &&
      allQuestionsAnswered
    ) {
      await userSurvey.update({ status: UserSurveyStatus.submitted });
      return res.status(200).json({
        success: true,
        message: 'User survey submitted successfully',
      });
    }

    try {
      // Create or update answers
      const answerPromises = incomingAnswers.map(async (a) => {
        let existingAnswer = await Answer.findOne({
          where: { questionId: a.questionId, userSurveyId: userSurvey.id },
        });

        if (existingAnswer) {
          await existingAnswer.update({ answer: a.answer });
        } else {
          await Answer.create({
            answer: a.answer,
            questionId: a.questionId,
            userSurveyId: userSurvey.id,
          });
        }
      });

      await Promise.all(answerPromises);

      return res.status(200).json({
        success: true,
        message: 'Answers updated successfully',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';

      return res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }
  })
);

// update survey (admin)
router.put(
  '/admin/survey/:id',
  auth,
  asyncWrapper(async (req, res) => {
    try {
      const { id } = req.params;
      const { title, categoryIds, questions, status } = req.body;
      const requestorEmail = req.body.jwt.email;

      const user = await getUserByEmail(requestorEmail);

      if (!user || user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Permission denied',
        });
      }

      const survey = await Survey.findByPk(id);

      if (!survey) {
        return res
          .status(404)
          .json({ success: false, message: 'Survey not found' });
      }

      if (survey.status === 'published') {
        return res.status(400).json({
          success: false,
          message: 'Cannot update a published survey',
        });
      }

      if (title) {
        survey.title = title;
      }

      if (status && status === 'published') {
        survey.status = status;
      }

      // logic below assumes there will be an endpoint to delete a category from a survey
      if (categoryIds && Array.isArray(categoryIds)) {
        const existingCategories = await Category.findAll({
          where: { id: categoryIds },
        });

        const currentSurveyCategories = await survey.getCategories();

        await survey.addCategories(
          Array.from(
            new Set([...existingCategories, ...currentSurveyCategories])
          )
        );
      }

      if (questions && Array.isArray(questions)) {
        for (const q of questions) {
          if (q.id) {
            // If the questionId exists, update the question
            const existingQuestion = await Question.findByPk(q.id);
            if (existingQuestion) {
              existingQuestion.question = q.question;
              await existingQuestion.save();
            }
          } else {
            await Question.create({
              question: q.question,
              surveyId: survey.id,
            });
          }
        }
      }

      await survey.save();

      return res.status(200).json({
        success: true,
        message: 'Survey updated successfully',
      });
    } catch (error) {
      console.error('Error updating survey:', error);
      return res
        .status(500)
        .json({ success: false, message: 'Internal Server Error' });
    }
  })
);

export default router;
