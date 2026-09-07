import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Controller } from '../../lib/core/Controller'
import { Body, Get, Hidden, Path, Post, Query, Response, Route, SuccessResponse } from '../../lib/core/Decorators'
import { OpenApiGenerator } from '../../lib/core/OpenApiGenerator'
import { RouteManager } from '../../lib/core/RouteManager'

describe('OpenApiGenerator', () => {
  beforeEach(() => {
    RouteManager.reset()

    @Route('api/recipes')
    class RecipeController extends Controller {
      public constructor() {
        super()
      }

      @Get('')
      @SuccessResponse(200, 'OK')
      public async listRecipes(@Query('tag') tag?: string): Promise<string[]> {
        void tag
        return []
      }

      @Get('{id}')
      @Response(404, 'No such recipe')
      public async getRecipe(@Path() id: string): Promise<{ id: string }> {
        return { id }
      }

      @Post('')
      @SuccessResponse(201, 'Created')
      public async createRecipe(@Body() body: unknown): Promise<unknown> {
        return body
      }

      @Get('internal')
      @Hidden()
      public async internals(): Promise<void> {}
    }

    new RecipeController()
    RouteManager.initializeRoutes(express.Router())
  })

  afterEach(() => RouteManager.reset())

  const spec = () => OpenApiGenerator.generate({ title: 'test', version: '1.0.0' }) as any

  it('describes every registered path in OpenAPI parameter syntax', () => {
    const paths = Object.keys(spec().paths)

    expect(paths).toContain('/api/recipes')
    // Express ':id' becomes '{id}'
    expect(paths).toContain('/api/recipes/{id}')
  })

  it('omits hidden endpoints', () => {
    expect(Object.keys(spec().paths)).not.toContain('/api/recipes/internal')
  })

  it('documents query and path parameters', () => {
    const list = spec().paths['/api/recipes'].get
    expect(list.parameters).toEqual([{ name: 'tag', in: 'query', required: false, schema: { type: 'string' } }])

    const single = spec().paths['/api/recipes/{id}'].get
    expect(single.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }])
  })

  it('uses the @SuccessResponse code and adds documented errors', () => {
    const created = spec().paths['/api/recipes'].post
    expect(Object.keys(created.responses)).toContain('201')
    expect(created.requestBody).toBeDefined()

    const single = spec().paths['/api/recipes/{id}'].get
    expect(single.responses['404'].description).toBe('No such recipe')
    // Every operation documents a 500 whether or not it was declared.
    expect(single.responses['500']).toBeDefined()
  })

  it('derives readable summaries from handler names', () => {
    expect(spec().paths['/api/recipes'].get.summary).toBe('List recipes')
  })
})
